import type { BunRequest } from "bun";
import { redirectIfAuthenticated } from "../../middleware/auth";
import {
  PASSWORD_RESET_EXPIRY_MINUTES,
  regenerateSession,
} from "../../services/auth";
import { passwordAuthEnabled } from "../../services/auth-mode";
import { captchaEnabled, issueChallenge } from "../../services/captcha";
import { getEmailService } from "../../services/email";
import { log } from "../../services/logger";
import {
  createPasswordReset,
  type ResetPasswordResult,
  resetPassword,
} from "../../services/passwords";
import {
  getSessionIdFromRequest,
  setSessionCookie,
} from "../../services/sessions";
import type { ForgotPasswordState } from "../../templates/forgot-password";
import { ForgotPassword } from "../../templates/forgot-password";
import type { ResetPasswordState } from "../../templates/reset-password";
import { ResetPassword } from "../../templates/reset-password";
import { appUrl } from "../../utils/app-url";
import { render404 } from "../../utils/errors";
import { redirect, render } from "../../utils/response";
import { stateHelpers } from "../../utils/state";
import { guardAuthForm, readEmail, readPassword } from "./form-guard";
import { landingAfterAuth } from "./landing";

const forgotFlash = stateHelpers<ForgotPasswordState>();
const resetFlash = stateHelpers<ResetPasswordState>();

/**
 * Password reset, in two halves: request a link at /forgot-password, spend it
 * at /reset-password?token=…
 *
 * Both 404 outside password mode — there is nothing to reset when accounts sign
 * in by magic link.
 */
export const passwordReset = {
  async index(req: BunRequest): Promise<Response> {
    if (!passwordAuthEnabled()) return render404();

    const authRedirect = await redirectIfAuthenticated(req);
    if (authRedirect) return authRedirect;

    // /login links here with ?email= after a sign-in against an account that
    // predates password auth. Flash wins, so a failed POST redirect back here
    // keeps what was actually typed. Only something address-shaped is accepted
    // — hygiene, not escaping: defaultValue is escaped on render either way.
    const flash = forgotFlash.getFlash(req);
    const prefill = new URL(req.url).searchParams.get("email");
    const state = {
      ...flash,
      email:
        flash.email ??
        (prefill?.includes("@") && prefill.length <= 254 ? prefill : undefined),
    };

    return render(
      <ForgotPassword
        state={state}
        challenge={captchaEnabled() ? issueChallenge() : null}
      />,
    );
  },

  async create(req: BunRequest): Promise<Response> {
    if (!passwordAuthEnabled()) return render404();

    const guard = await guardAuthForm(req);

    if (!guard.ok) {
      if (guard.reason === "rate-limited") return guard.response;

      if (guard.reason === "honeypot") {
        log.warn("password-reset", "honeypot tripped, dropping submission");
        forgotFlash.setFlash(req, { state: "email-sent" });
        return redirect("/forgot-password");
      }

      // The address survives a failed challenge: a stale captcha is nobody's
      // mistake, and making them retype it to get a fresh one is friction with
      // nothing to show for it.
      forgotFlash.setFlash(req, {
        state: "validation-error",
        error: "Verification failed. Please try again.",
        email: readEmail(guard.formData),
      });
      return redirect("/forgot-password");
    }

    const email = readEmail(guard.formData);

    if (!email || !email.includes("@")) {
      forgotFlash.setFlash(req, {
        state: "validation-error",
        error: "Invalid email address",
        email,
      });
      return redirect("/forgot-password");
    }

    try {
      const reset = await createPasswordReset(email);

      if (reset) {
        await getEmailService().sendPasswordReset({
          to: { email: reset.user.email },
          resetUrl: appUrl(`/reset-password?token=${reset.rawToken}`),
          expiryMinutes: PASSWORD_RESET_EXPIRY_MINUTES,
        });
      }
    } catch (error) {
      // Swallowed on purpose: a visible failure here would distinguish "we
      // tried to send" from "there was nothing to send", which is exactly what
      // the identical response is meant to hide.
      log.error("password-reset", `failed to send reset email: ${error}`);
    }

    forgotFlash.setFlash(req, { state: "email-sent" });
    return redirect("/forgot-password");
  },

  async edit(req: BunRequest): Promise<Response> {
    if (!passwordAuthEnabled()) return render404();

    const token = new URL(req.url).searchParams.get("token") ?? "";
    const state = resetFlash.getFlash(req);

    // The token isn't checked here — only spending it proves anything, and a
    // probe that reported "valid link" on GET would let an attacker sort real
    // tokens from guesses without ever committing to one.

    // A flashed invalid-token message is carried through — redirecting here
    // without a token is how the dead ends below reach the visitor at all. Any
    // other state belongs to the form this branch isn't rendering.
    if (!token) {
      return render(
        <ResetPassword
          token=""
          state={
            state.state === "invalid-token" ? state : { state: "invalid-token" }
          }
        />,
      );
    }

    const challenge = captchaEnabled() ? issueChallenge() : null;

    return render(
      <ResetPassword token={token} state={state} challenge={challenge} />,
    );
  },

  async update(req: BunRequest): Promise<Response> {
    if (!passwordAuthEnabled()) return render404();

    const guard = await guardAuthForm(req);

    if (!guard.ok) {
      if (guard.reason === "rate-limited") return guard.response;

      // No feigned success here — the visitor is mid-flow and needs to know the
      // password didn't change. Nothing spent the token, though, so put them
      // back on the same link: telling someone their link expired because a
      // captcha challenge went stale would cost them a whole new email.
      const attempted = guard.formData.get("token");

      return typeof attempted === "string" && attempted
        ? retryWithToken(
            req,
            attempted,
            "Verification failed. Please try again.",
          )
        : invalidToken(req);
    }

    const token = guard.formData.get("token");
    const password = readPassword(guard.formData, "password");

    if (typeof token !== "string" || !token) {
      return invalidToken(req);
    }

    let result: ResetPasswordResult;

    try {
      result = await resetPassword(token, password);
    } catch (error) {
      // Reaching here means the token was already spent, so there is no link to
      // send them back to and no way to know whether the new password stuck.
      // Signing them in would be worse than saying so: the session purge is the
      // step most likely to have failed, and this is the flow you use when you
      // believe someone else is holding one of those sessions.
      log.error("password-reset", `failed to complete reset: ${error}`);
      resetFlash.setFlash(req, {
        state: "invalid-token",
        error:
          "Something went wrong finishing that reset. Try signing in with your new password — if that doesn't work, request another link.",
      });
      return redirect("/reset-password");
    }

    if (!result.success) {
      // The token survives an invalid password, so send them back to the same
      // link rather than making them request a new one over a typo.
      return result.error === "invalid-password"
        ? retryWithToken(
            req,
            token,
            "Password must be between 8 and 128 characters.",
          )
        : invalidToken(req);
    }

    // resetPassword destroyed every session the user had, including any guest
    // session this request arrived with, so this is a clean sign-in.
    const sessionId = await regenerateSession(
      result.user.id,
      getSessionIdFromRequest(req),
    );
    setSessionCookie(req, sessionId);

    return redirect(await landingAfterAuth(result.user.id));
  },
};

/** Dead end: the token is gone or spent, and only a new email gets them back. */
const invalidToken = (req: BunRequest): Response => {
  resetFlash.setFlash(req, {
    state: "invalid-token",
    error: "That reset link is invalid or has expired. Request a new one.",
  });
  return redirect("/reset-password");
};

/** Recoverable: the token is still good, so re-render the form behind it. */
const retryWithToken = (
  req: BunRequest,
  token: string,
  error: string,
): Response => {
  resetFlash.setFlash(req, { state: "validation-error", error });
  return redirect(`/reset-password?token=${encodeURIComponent(token)}`);
};
