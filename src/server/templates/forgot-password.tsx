import { AuthPage } from "../components/auth-page";
import { CaptchaWidget } from "../components/captcha-widget";
import { Flash } from "../components/flash";
import { FormField } from "../components/form-field";
import { Honeypot } from "../components/honeypot";
import type { CaptchaChallenge } from "../services/captcha";

export interface ForgotPasswordState {
  state?: "email-sent" | "validation-error";
  error?: string;
  email?: string;
}

export interface ForgotPasswordProps {
  state?: ForgotPasswordState;
  challenge?: CaptchaChallenge | null;
}

export const ForgotPassword = ({ state, challenge }: ForgotPasswordProps) => (
  <AuthPage
    title="Reset your password - Billet"
    description="Request a link to reset your Billet password."
    canonicalPath="/forgot-password"
    heading="Reset your password"
    subtitle="We'll email you a link to choose a new one"
    footer={
      <>
        <a href="/login">Back to sign in</a>
        {" · "}
        <a href="/">Back to home</a>
      </>
    }
  >
    {state?.state === "email-sent" ? (
      // Shown whether or not the address is registered — a different message
      // for "no such account" would turn this form into an account checker.
      <Flash type="success">
        <p>Check your email!</p>
        <p>
          If an account exists for that address, we've sent a link to reset the
          password.
        </p>
        <p>For testing: Check the server console for the link.</p>
      </Flash>
    ) : (
      <form method="POST" action="/forgot-password">
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

        <Honeypot />

        <CaptchaWidget challenge={challenge} />

        <button type="submit" className="login-submit">
          Send reset link
        </button>
      </form>
    )}
  </AuthPage>
);
