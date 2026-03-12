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
      <main
        style={{
          minHeight: "100vh",
          background: "var(--color-bg)",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          padding: "48px 16px",
        }}
      >
        <div style={{ width: "100%", maxWidth: "400px" }}>
          <div style={{ textAlign: "center", marginBottom: "32px" }}>
            <a
              href="/"
              style={{
                display: "inline-flex",
                color: "var(--color-text)",
              }}
            >
              <Logo />
            </a>
          </div>

          <div
            style={{
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius)",
              padding: "32px",
            }}
          >
            <h2
              style={{
                fontSize: "1.25rem",
                fontWeight: 600,
                color: "var(--color-text)",
                marginBottom: "4px",
                textAlign: "center",
              }}
            >
              Sign in to your account
            </h2>
            <p
              style={{
                fontSize: "14px",
                color: "var(--color-text-tertiary)",
                textAlign: "center",
                marginBottom: "24px",
              }}
            >
              We'll send you a magic link to sign in instantly
            </p>

            {state?.state === "email-sent" ? (
              <div className="flash-success">
                <p
                  style={{
                    fontWeight: 500,
                    color: "var(--color-text)",
                    margin: 0,
                  }}
                >
                  Check your email!
                </p>
                <p
                  style={{
                    color: "var(--color-text-secondary)",
                    fontSize: "14px",
                    marginTop: "4px",
                    marginBottom: 0,
                  }}
                >
                  We've sent you a magic link. Click it to sign in instantly.
                </p>
                <p
                  style={{
                    color: "var(--color-text-quaternary)",
                    fontSize: "12px",
                    marginTop: "8px",
                    marginBottom: 0,
                  }}
                >
                  For testing: Check the server console for the magic link.
                </p>
              </div>
            ) : (
              <form method="POST" action="/login">
                {state?.state === "validation-error" && state.error && (
                  <div className="flash-error">
                    <span
                      style={{
                        fontSize: "14px",
                        color: "var(--color-text-secondary)",
                      }}
                    >
                      {state.error}
                    </span>
                  </div>
                )}

                <div style={{ marginBottom: "20px" }}>
                  <label
                    htmlFor="email"
                    style={{
                      display: "block",
                      fontSize: "14px",
                      fontWeight: 500,
                      color: "var(--color-text-secondary)",
                      marginBottom: "6px",
                    }}
                  >
                    Email address
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    placeholder="Enter your email"
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      background: "var(--color-surface)",
                      border: "1px solid var(--color-border)",
                      borderRadius: "var(--radius)",
                      color: "var(--color-text)",
                      fontSize: "14px",
                    }}
                  />
                </div>

                <button
                  type="submit"
                  style={{
                    width: "100%",
                    padding: "8px 16px",
                    background: "var(--color-primary)",
                    color: "#fff",
                    border: "none",
                    borderRadius: "var(--radius)",
                    fontSize: "14px",
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  Send magic link
                </button>
              </form>
            )}

            <div style={{ textAlign: "center", marginTop: "24px" }}>
              <a
                href="/"
                style={{
                  fontSize: "14px",
                  color: "var(--color-text-quaternary)",
                }}
              >
                Back to home
              </a>
            </div>
          </div>
        </div>
      </main>
    </BaseLayout>
  );
};
