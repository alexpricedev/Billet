import { AuthPage } from "../components/auth-page";
import { CaptchaWidget } from "../components/captcha-widget";
import { Flash } from "../components/flash";
import { FormField } from "../components/form-field";
import { Honeypot } from "../components/honeypot";
import type { AuthMode } from "../services/auth-mode";
import type { CaptchaChallenge } from "../services/captcha";

export interface LoginState {
  // "no-password" is a failed sign-in against an account carried over from
  // magic-link mode. It renders like a validation error but carries a way out,
  // because there is no password the user could have typed correctly.
  state?: "email-sent" | "validation-error" | "no-password";
  error?: string;
  // Preserved across the redirect so a failed attempt doesn't make the user
  // retype their address. The password is deliberately never carried back —
  // flash state lives in a cookie.
  email?: string;
}

export interface LoginProps {
  mode: AuthMode;
  state?: LoginState;
  challenge?: CaptchaChallenge | null;
}

export const Login = ({ mode, state, challenge }: LoginProps) => {
  const password = mode === "password";

  return (
    <AuthPage
      title="Login - Billet"
      description={
        password
          ? "Log in to Billet with your email and password."
          : "Log in to Billet with a magic link — no passwords to remember."
      }
      canonicalPath="/login"
      heading="Sign in to your account"
      subtitle={
        password
          ? "Enter your email and password to continue"
          : "We'll send you a magic link to sign in instantly"
      }
      footer={
        <>
          <a href="/signup">Create an account</a>
          {" · "}
          <a href="/">Back to home</a>
        </>
      }
    >
      {state?.state === "email-sent" ? (
        <Flash type="success">
          <p>Check your email!</p>
          <p>We've sent you a magic link. Click it to sign in instantly.</p>
          <p>For testing: Check the server console for the magic link.</p>
        </Flash>
      ) : (
        <form method="POST" action="/login">
          {(state?.state === "validation-error" ||
            state?.state === "no-password") &&
            state.error && (
              <Flash type="error">
                <span>{state.error}</span>
                {/* The message alone is a dead end — nothing on this page tells
                    someone that the reset flow is also how you set a first
                    password. */}
                {state.state === "no-password" && (
                  <p className="flash-action">
                    <a href="/forgot-password">Set your password</a>
                  </p>
                )}
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
                autoComplete="current-password"
                required
                placeholder="Enter your password"
              />
            </FormField>
          )}

          <Honeypot />

          <CaptchaWidget challenge={challenge} />

          <button type="submit" className="login-submit">
            {password ? "Sign in" : "Send magic link"}
          </button>

          {password && (
            <p className="login-aside">
              <a href="/forgot-password">Forgot your password?</a>
            </p>
          )}
        </form>
      )}
    </AuthPage>
  );
};
