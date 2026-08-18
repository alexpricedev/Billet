import { AuthPage } from "../components/auth-page";
import { CaptchaWidget } from "../components/captcha-widget";
import { Flash } from "../components/flash";
import { FormField } from "../components/form-field";
import { Honeypot } from "../components/honeypot";
import type { AuthMode } from "../services/auth-mode";
import type { CaptchaChallenge } from "../services/captcha";
import {
  MAX_ORGANISATION_NAME_LENGTH,
  MIN_ORGANISATION_NAME_LENGTH,
} from "../services/organisations";
import { MIN_PASSWORD_LENGTH } from "../services/passwords";

export interface SignupState {
  state?: "email-sent" | "validation-error";
  error?: string;
  email?: string;
  // Carried back on a failed submission so a rejected password or a taken
  // address doesn't cost the organisation name too. Safe to put in the flash
  // cookie — it is a display name, not a credential.
  organisationName?: string;
}

export interface SignupProps {
  mode: AuthMode;
  state?: SignupState;
  challenge?: CaptchaChallenge | null;
  // Passed in rather than read from the service, so the template stays a pure
  // function of its props — same discipline as `mode`.
  organisationsEnabled?: boolean;
}

export const Signup = ({
  mode,
  state,
  challenge,
  organisationsEnabled = false,
}: SignupProps) => {
  const password = mode === "password";

  return (
    <AuthPage
      title="Sign up - Billet"
      description={
        password
          ? "Create a Billet account with an email and password."
          : "Create a Billet account — we'll email you a link to get started."
      }
      canonicalPath="/signup"
      heading="Create your account"
      subtitle={
        password
          ? "Pick a password and you're in"
          : "We'll email you a link to get started — no password needed"
      }
      footer={
        <>
          <a href="/login">Already have an account?</a>
          {" · "}
          <a href="/">Back to home</a>
        </>
      }
    >
      {state?.state === "email-sent" ? (
        <Flash type="success">
          <p>Check your email!</p>
          <p>We've sent you a link to finish setting up your account.</p>
          <p>For testing: Check the server console for the link.</p>
        </Flash>
      ) : (
        <form method="POST" action="/signup">
          {state?.state === "validation-error" && state.error && (
            <Flash type="error">
              <span>{state.error}</span>
            </Flash>
          )}

          <FormField label="Email address" id="email">
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="Enter your email"
              defaultValue={state?.email}
            />
          </FormField>

          {password && (
            <FormField label="Password" id="password">
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={MIN_PASSWORD_LENGTH}
                placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
              />
            </FormField>
          )}

          {organisationsEnabled && (
            <FormField label="Organisation name" id="organisationName">
              <input
                id="organisationName"
                name="organisationName"
                type="text"
                autoComplete="organization"
                required
                minLength={MIN_ORGANISATION_NAME_LENGTH}
                maxLength={MAX_ORGANISATION_NAME_LENGTH}
                placeholder="Your company or team name"
                defaultValue={state?.organisationName}
              />
            </FormField>
          )}

          <Honeypot />

          <CaptchaWidget challenge={challenge} />

          <button type="submit" className="login-submit">
            {password ? "Create account" : "Send sign-up link"}
          </button>
        </form>
      )}
    </AuthPage>
  );
};
