import { AuthPage } from "../components/auth-page";
import { CaptchaWidget } from "../components/captcha-widget";
import { Flash } from "../components/flash";
import { FormField } from "../components/form-field";
import { Honeypot } from "../components/honeypot";
import type { CaptchaChallenge } from "../services/captcha";
import { MIN_PASSWORD_LENGTH } from "../services/passwords";

export interface ResetPasswordState {
  state?: "validation-error" | "invalid-token";
  error?: string;
}

export interface ResetPasswordProps {
  token: string;
  state?: ResetPasswordState;
  challenge?: CaptchaChallenge | null;
}

export const ResetPassword = ({
  token,
  state,
  challenge,
}: ResetPasswordProps) => (
  <AuthPage
    title="Choose a new password - Billet"
    description="Set a new password for your Billet account."
    canonicalPath="/reset-password"
    heading="Choose a new password"
    subtitle="This will sign you out everywhere else"
    footer={
      <>
        <a href="/login">Back to sign in</a>
        {" · "}
        <a href="/forgot-password">Request a new link</a>
      </>
    }
  >
    {state?.state === "invalid-token" ? (
      <Flash type="error">
        <span>
          {state.error ??
            "That reset link is invalid or has expired. Request a new one."}
        </span>
      </Flash>
    ) : (
      <form method="POST" action="/reset-password">
        {state?.state === "validation-error" && state.error && (
          <Flash type="error">
            <span>{state.error}</span>
          </Flash>
        )}

        {/* The token travels in the form rather than the action URL so it stays
            out of the Referer header when the browser follows a link from this
            page. */}
        <input type="hidden" name="token" value={token} />

        <FormField label="New password" id="password">
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

        <Honeypot />

        <CaptchaWidget challenge={challenge} />

        <button type="submit" className="login-submit">
          Set new password
        </button>
      </form>
    )}
  </AuthPage>
);
