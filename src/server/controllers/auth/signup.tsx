import type { BunRequest } from "bun";
import { redirectIfAuthenticated } from "../../middleware/auth";
import {
  createMagicLink,
  createUserToken,
  EMAIL_VERIFICATION_EXPIRY_HOURS,
  findUserByEmail,
  MAGIC_LINK_EXPIRY_MINUTES,
  regenerateSession,
  type User,
} from "../../services/auth";
import { authMode, passwordAuthEnabled } from "../../services/auth-mode";
import { captchaEnabled, issueChallenge } from "../../services/captcha";
import { getEmailService } from "../../services/email";
import { log } from "../../services/logger";
import {
  signUpWithOrganisation,
  validateOrganisationName,
} from "../../services/organisations";
import { organisationsEnabled } from "../../services/organisations-mode";
import {
  type SignUpResult,
  signUpWithPassword,
  validatePassword,
} from "../../services/passwords";
import {
  getSessionIdFromRequest,
  setSessionCookie,
} from "../../services/sessions";
import type { SignupState } from "../../templates/signup";
import { Signup } from "../../templates/signup";
import { appUrl } from "../../utils/app-url";
import { hashPassword } from "../../utils/crypto";
import { redirect, render } from "../../utils/response";
import { stateHelpers } from "../../utils/state";
import {
  guardAuthForm,
  readEmail,
  readOrganisationName,
  readPassword,
} from "./form-guard";

const { getFlash, setFlash } = stateHelpers<SignupState>();

/**
 * Sign-up exists in both auth modes. In magic-link mode it is the same
 * mechanism as /login with sign-up wording — the link creates the account on
 * first use — which is worth a separate page because "create an account" and
 * "sign in" are different intentions even when the plumbing is identical.
 */
export const signup = {
  async index(req: BunRequest): Promise<Response> {
    const authRedirect = await redirectIfAuthenticated(req);
    if (authRedirect) return authRedirect;

    const state = getFlash(req);
    const challenge = captchaEnabled() ? issueChallenge() : null;

    return render(
      <Signup
        mode={authMode()}
        state={state}
        challenge={challenge}
        organisationsEnabled={organisationsEnabled()}
      />,
    );
  },

  async create(req: BunRequest): Promise<Response> {
    const guard = await guardAuthForm(req);

    if (!guard.ok) {
      if (guard.reason === "rate-limited") return guard.response;

      if (guard.reason === "honeypot") {
        log.warn("signup", "honeypot tripped, dropping submission");
        setFlash(req, feignedFailure(guard.formData));
        return redirect("/signup");
      }

      setFlash(req, {
        state: "validation-error",
        error: "Verification failed. Please try again.",
      });
      return redirect("/signup");
    }

    const email = readEmail(guard.formData);

    if (!email || !email.includes("@")) {
      setFlash(req, {
        state: "validation-error",
        error: "Invalid email address",
      });
      return redirect("/signup");
    }

    // Read regardless of the flag so the honeypot's feigned failure can hand it
    // back; only validated, and only used, when organisations are on.
    const organisationName = readOrganisationName(guard.formData);

    if (organisationsEnabled()) {
      const nameError = validateOrganisationName(organisationName);
      if (nameError) {
        setFlash(req, {
          state: "validation-error",
          error: nameError,
          email,
          organisationName,
        });
        return redirect("/signup");
      }
    }

    return passwordAuthEnabled()
      ? createPasswordAccount(req, email, organisationName, guard.formData)
      : sendSignupLink(req, email, organisationName);
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
        organisationName: readOrganisationName(formData),
      }
    : { state: "email-sent" };

/**
 * The organisations-mode twin of createMagicLink.
 *
 * createMagicLink creates the account as a side effect of findOrCreateUser,
 * which has no organisation name to work with. Here a brand-new address gets its
 * account, organisation and owner membership in one transaction; a known address
 * just gets a link, because it already belongs to an organisation — or the app
 * would have refused to boot.
 */
const createMagicLinkWithOrganisation = async (
  email: string,
  organisationName: string,
): Promise<{ user: User; rawToken: string }> => {
  const linkFor = async (user: User) => ({
    user,
    rawToken: await createUserToken(user.id, "magic_link"),
  });

  const existing = await findUserByEmail(email);
  if (existing) return linkFor(existing);

  const result = await signUpWithOrganisation(email, organisationName);
  if (result.success) return linkFor(result.user);

  // Lost the race with a concurrent sign-up for the same address — almost always
  // a double submission. Whoever won created the organisation, so this request
  // only owes the user a link.
  const raced = await findUserByEmail(email);
  if (!raced) throw new Error("sign-up failed");

  return linkFor(raced);
};

const sendSignupLink = async (
  req: BunRequest,
  email: string,
  organisationName: string,
): Promise<Response> => {
  try {
    const { user, rawToken } = organisationsEnabled()
      ? await createMagicLinkWithOrganisation(
          email.toLowerCase(),
          organisationName,
        )
      : await createMagicLink(email.toLowerCase());

    await getEmailService().sendMagicLink({
      to: { email: user.email },
      magicLinkUrl: appUrl(`/auth/callback?token=${rawToken}`),
      expiryMinutes: MAGIC_LINK_EXPIRY_MINUTES,
    });

    setFlash(req, { state: "email-sent" });
    return redirect("/signup");
  } catch {
    setFlash(req, {
      state: "validation-error",
      error: "Something went wrong. Please try again.",
    });
    return redirect("/signup");
  }
};

/**
 * The organisations-mode twin of signUpWithPassword, returning the same shape so
 * the caller handles both identically. The hashing happens here rather than
 * inside the transaction because argon2id is deliberately slow, and holding a
 * database transaction open for it would be a poor trade.
 */
const signUpPasswordWithOrganisation = async (
  email: string,
  password: string,
  organisationName: string,
): Promise<SignUpResult> => {
  const passwordHash = await hashPassword(password);
  const result = await signUpWithOrganisation(
    email,
    organisationName,
    passwordHash,
  );

  if (!result.success) return { success: false, error: "email-taken" };

  return {
    success: true,
    user: result.user,
    verifyToken: await createUserToken(result.user.id, "email_verification"),
  };
};

const createPasswordAccount = async (
  req: BunRequest,
  email: string,
  organisationName: string,
  formData: FormData,
): Promise<Response> => {
  const password = readPassword(formData, "password");

  const passwordError = validatePassword(password);
  if (passwordError) {
    setFlash(req, {
      state: "validation-error",
      error: passwordError,
      email,
      organisationName,
    });
    return redirect("/signup");
  }

  try {
    const result = organisationsEnabled()
      ? await signUpPasswordWithOrganisation(email, password, organisationName)
      : await signUpWithPassword(email, password);

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
        organisationName,
      });
      return redirect("/signup");
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

    return redirect("/");
  } catch {
    setFlash(req, {
      state: "validation-error",
      error: "Something went wrong. Please try again.",
      email,
      organisationName,
    });
    return redirect("/signup");
  }
};
