import { Flash } from "../components/flash";
import { FormField } from "../components/form-field";
import { BaseLayout } from "../components/layouts";
import { Logo } from "../components/logo";

export interface LoginState {
  state?: "email-sent" | "validation-error";
  error?: string;
}

export interface LoginProps {
  state?: LoginState;
}

export const Login = ({ state }: LoginProps) => {
  return (
    <BaseLayout title="Login - Billet">
      <main className="login-page">
        <div className="login-wrapper">
          <div className="login-header">
            <a href="/">
              <Logo />
            </a>
          </div>

          <div className="login-card">
            <h2 className="login-title">Sign in to your account</h2>
            <p className="login-subtitle">
              We'll send you a magic link to sign in instantly
            </p>

            {state?.state === "email-sent" ? (
              <Flash type="success">
                <p>Check your email!</p>
                <p>
                  We've sent you a magic link. Click it to sign in instantly.
                </p>
                <p>For testing: Check the server console for the magic link.</p>
              </Flash>
            ) : (
              <form method="POST" action="/login">
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
                  />
                </FormField>

                <button type="submit" className="login-submit">
                  Send magic link
                </button>
              </form>
            )}

            <div className="login-footer">
              <a href="/">Back to home</a>
            </div>
          </div>
        </div>
      </main>
    </BaseLayout>
  );
};
