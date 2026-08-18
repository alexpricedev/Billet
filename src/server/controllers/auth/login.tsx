import type { BunRequest } from "bun";
import { redirectIfAuthenticated } from "../../middleware/auth";
import {
  createMagicLink,
  findUserByEmail,
  MAGIC_LINK_EXPIRY_MINUTES,
  regenerateSession,
} from "../../services/auth";
import { authMode, passwordAuthEnabled } from "../../services/auth-mode";
import { captchaEnabled, issueChallenge } from "../../services/captcha";
import { getEmailService } from "../../services/email";
import { log } from "../../services/logger";
import { organisationsEnabled } from "../../services/organisations-mode";
import { signInWithPassword } from "../../services/passwords";
import {
  getSessionIdFromRequest,
  setSessionCookie,
} from "../../services/sessions";
import type { LoginState } from "../../templates/login";
import { Login } from "../../templates/login";
import { appUrl } from "../../utils/app-url";
import { redirect, render } from "../../utils/response";
import { stateHelpers } from "../../utils/state";
import { guardAuthForm, readEmail, readPassword } from "./form-guard";

const { getFlash, setFlash } = stateHelpers<LoginState>();

export const login = {
  async index(req: BunRequest): Promise<Response> {
    const authRedirect = await redirectIfAuthenticated(req);
    if (authRedirect) return authRedirect;

    const state = getFlash(req);
    const challenge = captchaEnabled() ? issueChallenge() : null;

    return render(
      <Login mode={authMode()} state={state} challenge={challenge} />,
    );
  },

  async create(req: BunRequest): Promise<Response> {
    const guard = await guardAuthForm(req);

    if (!guard.ok) {
      if (guard.reason === "rate-limited") return guard.response;

      if (guard.reason === "honeypot") {
        log.warn("login", "honeypot tripped, dropping submission");
        setFlash(req, feignedFailure(guard.formData));
        return redirect("/login");
      }

      setFlash(req, {
        state: "validation-error",
        error: "Verification failed. Please try again.",
      });
      return redirect("/login");
    }

    const email = readEmail(guard.formData);

    if (!email || !email.includes("@")) {
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
    // With organisations on, /login must not create accounts: createMagicLink
    // creates one for any unknown address via findOrCreateUser, and this form has
    // no organisation name to put on it. Sign-up is the only way in, so say so
    // rather than sending a link that would never arrive.
    //
    // This does make /login an account enumeration oracle — a deliberate trade,
    // the alternative being a silent no-op that strands a real user waiting for
    // an email. With the flag off, behaviour is unchanged.
    if (organisationsEnabled() && !(await findUserByEmail(email))) {
      setFlash(req, {
        state: "no-account",
        error: "No account exists with that email address.",
        email,
      });
      return redirect("/login");
    }

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

    return redirect("/");
  } catch {
    setFlash(req, {
      state: "validation-error",
      error: "Something went wrong. Please try again.",
      email,
    });
    return redirect("/login");
  }
};
