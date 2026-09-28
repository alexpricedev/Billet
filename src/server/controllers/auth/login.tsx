import type { BunRequest } from "bun";
import { guestPageContext } from "../../middleware/auth";
import {
  createMagicLink,
  MAGIC_LINK_EXPIRY_MINUTES,
  regenerateSession,
} from "../../services/auth";
import { authMode, passwordAuthEnabled } from "../../services/auth-mode";
import { captchaEnabled, issueChallenge } from "../../services/captcha";
import { consoleEmailProvider, getEmailService } from "../../services/email";
import { log } from "../../services/logger";
import { signInWithPassword } from "../../services/passwords";
import {
  getSessionIdFromRequest,
  setSessionCookie,
} from "../../services/sessions";
import type { LoginState } from "../../templates/login";
import { Login } from "../../templates/login";
import { appUrl } from "../../utils/app-url";
import { csrfTokens } from "../../utils/csrf-tokens";
import { type FlashMessage, getFlashCookie } from "../../utils/flash";
import { redirect, render } from "../../utils/response";
import { stateHelpers } from "../../utils/state";
import { guardAuthForm, readEmail, readPassword } from "./form-guard";
import { landingAfterAuth } from "./landing";

const { getFlash, setFlash } = stateHelpers<LoginState>();

export const login = {
  async index(req: BunRequest): Promise<Response> {
    const page = await guestPageContext(req);
    if ("redirect" in page) return page.redirect;

    // The form posts a CSRF token, so the guest session it binds to has to
    // reach the browser — minting one and dropping the cookie would render a
    // token nothing could verify.
    const { ctx } = page;
    if (ctx.requiresSetCookie && ctx.sessionId) {
      setSessionCookie(req, ctx.sessionId);
    }

    const state = getFlash(req);
    const challenge = captchaEnabled() ? issueChallenge() : null;

    // A flow that finishes by sending someone here to sign in leaves its line
    // on the "message" key — invite acceptance in password mode is the one
    // that does. Read here as well as on the homepage, or the cookie survives
    // unread and surfaces on whichever page happens to read it next.
    const message = getFlashCookie<Partial<FlashMessage>>(req, "message");

    // /auth/callback and the other single-use-link dead ends send people here
    // with ?error=. Flash wins when both are present — it belongs to something
    // that just happened on this page. Capped and rendered as text, never as
    // markup, so the query string can't put anything but words on the page.
    const queryError = new URL(req.url).searchParams.get("error");
    const resolved: LoginState =
      state.state || !queryError
        ? state
        : { state: "validation-error", error: queryError.slice(0, 200) };

    return render(
      <Login
        mode={authMode()}
        csrfToken={await csrfTokens(ctx).for("/login")}
        state={resolved}
        challenge={challenge}
        message={message.text ? (message as FlashMessage) : undefined}
        showConsoleHint={consoleEmailProvider()}
      />,
    );
  },

  async create(req: BunRequest): Promise<Response> {
    const guard = await guardAuthForm(req);

    if (!guard.ok) {
      if (guard.reason === "rate-limited" || guard.reason === "csrf") {
        return guard.response;
      }

      if (guard.reason === "honeypot") {
        log.warn("login", "honeypot tripped, dropping submission");
        setFlash(req, feignedFailure(guard.formData));
        return redirect("/login");
      }

      // A stale token is an old tab, not an attack. The address survives so
      // the retry costs a click; the redirect lands on a page that mints a
      // fresh token.
      if (guard.reason === "csrf-expired") {
        setFlash(req, {
          state: "validation-error",
          error: "This page expired while it was open. Please try again.",
          email: readEmail(guard.formData),
        });
        return redirect("/login");
      }

      setFlash(req, {
        state: "validation-error",
        error: "Verification failed. Please try again.",
      });
      return redirect("/login");
    }

    const email = readEmail(guard.formData);

    if (!email?.includes("@")) {
      setFlash(req, {
        state: "validation-error",
        error: "Invalid email address",
      });
      return redirect("/login");
    }

    return passwordAuthEnabled()
      ? signInWithPasswordAndRedirect(req, email, guard.formData)
      : sendMagicLinkAndRedirect(req, email);
  },
};

/**
 * What a dropped submission looks like to whoever sent it.
 *
 * The response must not name the trap, so it borrows a state the visitor could
 * have reached anyway. Which one depends on the mode: magic-link mode has
 * "check your email", indistinguishable from a real send. Password mode has no
 * equivalent — claiming a magic link was sent would be nonsense to a human who
 * tripped the honeypot by autofill — so it borrows the transient-failure
 * message instead, which is exactly what the catch blocks below render.
 */
const feignedFailure = (formData: FormData): LoginState =>
  passwordAuthEnabled()
    ? {
        state: "validation-error",
        error: "Something went wrong. Please try again.",
        email: readEmail(formData),
      }
    : { state: "email-sent" };

const sendMagicLinkAndRedirect = async (
  req: BunRequest,
  email: string,
): Promise<Response> => {
  try {
    const { user, rawToken } = await createMagicLink(email.toLowerCase());

    await getEmailService().sendMagicLink({
      to: { email: user.email },
      magicLinkUrl: appUrl(`/auth/callback?token=${rawToken}`),
      expiryMinutes: MAGIC_LINK_EXPIRY_MINUTES,
    });

    setFlash(req, { state: "email-sent" });
    return redirect("/login");
  } catch {
    setFlash(req, {
      state: "validation-error",
      error: "Something went wrong. Please try again.",
    });
    return redirect("/login");
  }
};

const signInWithPasswordAndRedirect = async (
  req: BunRequest,
  email: string,
  formData: FormData,
): Promise<Response> => {
  const password = readPassword(formData, "password");

  try {
    const result = await signInWithPassword(email, password);

    if (!result.success) {
      // One message for "no such account" and "wrong password" — separating
      // those two would tell an attacker which addresses are registered.
      //
      // An account carried over from magic-link mode is the exception, and it
      // has to be: it has no password, so every attempt fails and the generic
      // message never explains why. The template turns this state into a link
      // to /forgot-password, which sets a first password on a null hash.
      setFlash(
        req,
        result.reason === "no-password"
          ? {
              state: "no-password",
              error:
                "This account was created before password sign-in, so it doesn't have one yet.",
              email,
            }
          : {
              state: "validation-error",
              error: "Invalid email or password",
              email,
            },
      );
      return redirect("/login");
    }

    const sessionId = await regenerateSession(
      result.user.id,
      getSessionIdFromRequest(req),
    );
    setSessionCookie(req, sessionId);

    return redirect(await landingAfterAuth(result.user.id));
  } catch {
    setFlash(req, {
      state: "validation-error",
      error: "Something went wrong. Please try again.",
      email,
    });
    return redirect("/login");
  }
};
