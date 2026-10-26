import type { BunRequest } from "bun";
import { guestPageContext } from "../../middleware/auth";
import {
  createMagicLink,
  EMAIL_VERIFICATION_EXPIRY_HOURS,
  MAGIC_LINK_EXPIRY_MINUTES,
  regenerateSession,
} from "../../services/auth";
import { authMode, passwordAuthEnabled } from "../../services/auth-mode";
import { captchaEnabled, issueChallenge } from "../../services/captcha";
import { consoleEmailProvider, getEmailService } from "../../services/email";
import { log } from "../../services/logger";
import { signUpWithPassword, validatePassword } from "../../services/passwords";
import {
  getSessionIdFromRequest,
  setSessionCookie,
} from "../../services/sessions";
import type { SignupState } from "../../templates/signup";
import { Signup } from "../../templates/signup";
import { appUrl } from "../../utils/app-url";
import { csrfTokens } from "../../utils/csrf-tokens";
import { safeNextPath, withNext } from "../../utils/next-path";
import { redirect, render } from "../../utils/response";
import { stateHelpers } from "../../utils/state";
import { guardAuthForm, readEmail, readPassword } from "./form-guard";
import { landingAfterAuth } from "./landing";

const { getFlash, setFlash } = stateHelpers<SignupState>();

/**
 * Sign-up exists in both auth modes. In magic-link mode it is the same
 * mechanism as /login with sign-up wording — the link creates the account on
 * first use — which is worth a separate page because "create an account" and
 * "sign in" are different intentions even when the plumbing is identical.
 */
export const signup = {
  async index(req: BunRequest): Promise<Response> {
    const page = await guestPageContext(req);
    if ("redirect" in page) return page.redirect;

    // See login.index: the token binds to the guest session, so the cookie has
    // to go out with the page that carries it.
    const { ctx } = page;
    if (ctx.requiresSetCookie && ctx.sessionId) {
      setSessionCookie(req, ctx.sessionId);
    }

    const state = getFlash(req);
    const challenge = captchaEnabled() ? issueChallenge() : null;

    // See login.index: the same value, rendered into the same hidden field.
    const next = safeNextPath(new URL(req.url).searchParams.get("next"));

    return render(
      <Signup
        mode={authMode()}
        csrfToken={await csrfTokens(ctx).for("/signup")}
        state={state}
        challenge={challenge}
        showConsoleHint={consoleEmailProvider()}
        next={next}
      />,
    );
  },

  async create(req: BunRequest): Promise<Response> {
    const guard = await guardAuthForm(req);

    if (!guard.ok) {
      if (guard.reason === "rate-limited" || guard.reason === "csrf") {
        return guard.response;
      }

      // See login.tsx: the destination survives the trip back to the form.
      const next = safeNextPath(guard.formData.get("next"));

      if (guard.reason === "honeypot") {
        log.warn("signup", "honeypot tripped, dropping submission");
        setFlash(req, feignedFailure(guard.formData));
        return redirect(withNext("/signup", next));
      }

      // Stale token, not an attack — the twin of the branch in login.tsx.
      if (guard.reason === "csrf-expired") {
        setFlash(req, {
          state: "validation-error",
          error: "This page expired while it was open. Please try again.",
          email: readEmail(guard.formData),
        });
        return redirect(withNext("/signup", next));
      }

      setFlash(req, {
        state: "validation-error",
        error: "Verification failed. Please try again.",
      });
      return redirect(withNext("/signup", next));
    }

    const email = readEmail(guard.formData);
    const next = safeNextPath(guard.formData.get("next"));

    if (!email?.includes("@")) {
      setFlash(req, {
        state: "validation-error",
        error: "Invalid email address",
      });
      return redirect(withNext("/signup", next));
    }

    return passwordAuthEnabled()
      ? createPasswordAccount(req, email, guard.formData, next)
      : sendSignupLink(req, email, next);
  },
};

/**
 * What a dropped submission looks like to whoever sent it. See the twin in
 * login.tsx — password mode has no "check your email" state to borrow, and
 * telling someone an account is being set up when none was created strands
 * them at a sign-in that will never work.
 */
const feignedFailure = (formData: FormData): SignupState =>
  passwordAuthEnabled()
    ? {
        state: "validation-error",
        error: "Something went wrong. Please try again.",
        email: readEmail(formData),
      }
    : { state: "email-sent" };

const sendSignupLink = async (
  req: BunRequest,
  email: string,
  next: string | null,
): Promise<Response> => {
  try {
    const { user, rawToken } = await createMagicLink(email.toLowerCase());

    await getEmailService().sendMagicLink({
      to: { email: user.email },
      // The same hand-off as login: `next` rides the emailed URL, the confirm
      // page puts it in its form, and the form's POST redirects.
      magicLinkUrl: appUrl(withNext(`/auth/callback?token=${rawToken}`, next)),
      expiryMinutes: MAGIC_LINK_EXPIRY_MINUTES,
    });

    setFlash(req, { state: "email-sent" });
    return redirect(withNext("/signup", next));
  } catch {
    setFlash(req, {
      state: "validation-error",
      error: "Something went wrong. Please try again.",
    });
    return redirect(withNext("/signup", next));
  }
};

const createPasswordAccount = async (
  req: BunRequest,
  email: string,
  formData: FormData,
  next: string | null,
): Promise<Response> => {
  const password = readPassword(formData, "password");

  const passwordError = validatePassword(password);
  if (passwordError) {
    setFlash(req, {
      state: "validation-error",
      error: passwordError,
      email,
    });
    return redirect(withNext("/signup", next));
  }

  try {
    const result = await signUpWithPassword(email, password);

    if (!result.success) {
      // Sign-up can't hide that an address is taken — the alternative is either
      // logging someone into an account they may not own or claiming success
      // for an account that was never created. See services/passwords.ts.
      setFlash(req, {
        state: "validation-error",
        error:
          result.error === "email-taken"
            ? "An account with that email already exists. Try signing in instead."
            : "That password isn't valid. Please try another.",
        email,
      });
      return redirect(withNext("/signup", next));
    }

    const sessionId = await regenerateSession(
      result.user.id,
      getSessionIdFromRequest(req),
    );
    setSessionCookie(req, sessionId);

    // The account is usable before the address is confirmed, so a mail failure
    // must not cost the user their session — it's logged and the banner keeps
    // offering a resend.
    try {
      await getEmailService().sendVerifyEmail({
        to: { email: result.user.email },
        verifyUrl: appUrl(`/auth/verify?token=${result.verifyToken}`),
        expiryHours: EMAIL_VERIFICATION_EXPIRY_HOURS,
      });
    } catch (error) {
      log.error("signup", `failed to send verification email: ${error}`);
    }

    return redirect(await landingAfterAuth(result.user.id, next));
  } catch {
    setFlash(req, {
      state: "validation-error",
      error: "Something went wrong. Please try again.",
      email,
    });
    return redirect(withNext("/signup", next));
  }
};
