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
              <div className="flash-success">
                <p>Check your email!</p>
                <p>
                  We've sent you a magic link. Click it to sign in instantly.
                </p>
                <p>For testing: Check the server console for the magic link.</p>
              </div>
            ) : (
              <form method="POST" action="/login">
                {state?.state === "validation-error" && state.error && (
                  <div className="flash-error">
                    <span>{state.error}</span>
                  </div>
                )}

                <div className="login-field">
                  <label htmlFor="email">Email address</label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    placeholder="Enter your email"
                  />
                </div>

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
