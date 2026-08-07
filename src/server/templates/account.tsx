import { CsrfField } from "../components/csrf-field";
import { Flash } from "../components/flash";
import { FormField } from "../components/form-field";
import { Layout } from "../components/layouts";
import type { AuthMode } from "../services/auth-mode";
import { MIN_PASSWORD_LENGTH } from "../services/passwords";
import type { User } from "../services/users";

export interface AccountState {
  state?:
    | "verified"
    | "verification-sent"
    | "verify-failed"
    | "password-changed"
    | "password-set"
    | "password-error";
  error?: string;
}

export interface AccountProps {
  mode: AuthMode;
  user: User;
  // False for an account carried over from magic-link mode, which has no
  // password until it sets one here. Always false in magic-link mode.
  hasPassword: boolean;
  state?: AccountState;
  csrfToken?: string;
  resendCsrfToken?: string;
  passwordCsrfToken?: string;
}

const formatDate = (date: Date): string =>
  date.toLocaleDateString("en-GB", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

export const Account = ({
  mode,
  user,
  hasPassword,
  state,
  csrfToken,
  resendCsrfToken,
  passwordCsrfToken,
}: AccountProps) => (
  <Layout
    title="Account - Billet"
    name="account"
    description="Manage your Billet account."
    canonicalPath="/account"
    user={user}
    csrfToken={csrfToken}
    noindex
  >
    <h1>Account</h1>

    {state?.state === "verified" && (
      <Flash type="success">
        <span>Your email address is confirmed.</span>
      </Flash>
    )}

    {state?.state === "verification-sent" && (
      <Flash type="success">
        <span>
          Confirmation link sent to {user.email}. For testing: check the server
          console.
        </span>
      </Flash>
    )}

    {state?.state === "password-changed" && (
      <Flash type="success">
        <span>Password updated. You've been signed out everywhere else.</span>
      </Flash>
    )}

    {state?.state === "password-set" && (
      <Flash type="success">
        <span>
          Password set. You can now sign in with your email and password. You've
          been signed out everywhere else.
        </span>
      </Flash>
    )}

    {(state?.state === "verify-failed" || state?.state === "password-error") &&
      state.error && (
        <Flash type="error">
          <span>{state.error}</span>
        </Flash>
      )}

    <section className="account-section card">
      <h2>Email address</h2>
      <p className="account-email">{user.email}</p>

      {user.email_verified_at ? (
        <p className="text-tertiary">
          Confirmed on {formatDate(user.email_verified_at)}.
        </p>
      ) : (
        <div id="verify-email">
          <p className="text-tertiary">
            Not confirmed yet. We sent a link when you signed up — send another
            if you can't find it.
          </p>
          <form method="POST" action="/auth/verify/resend">
            <CsrfField token={resendCsrfToken ?? null} />
            <button type="submit" className="btn-ghost">
              Resend confirmation email
            </button>
          </form>
        </div>
      )}
    </section>

    {/* Only password accounts have a password to change. In magic-link mode
        there is nothing to render here, not even a disabled form.

        An account that predates the switch to password mode has no password
        yet, and asking it for a current one would be a form that can never
        succeed — so that case gets a set-a-password form instead. */}
    {mode === "password" && (
      <section className="account-section card">
        <h2>{hasPassword ? "Change password" : "Set a password"}</h2>
        <p className="text-tertiary">
          {hasPassword
            ? "Changing your password signs you out of every other device."
            : "This account was created before password sign-in and doesn't have one yet. Set a password to sign in with it from now on. Like a change, it signs you out of every other device."}
        </p>

        <form method="POST" action="/account/password">
          <CsrfField token={passwordCsrfToken ?? null} />

          {hasPassword && (
            <FormField label="Current password" id="current_password">
              <input
                id="current_password"
                name="current_password"
                type="password"
                autoComplete="current-password"
                required
              />
            </FormField>
          )}

          <FormField
            label={hasPassword ? "New password" : "Password"}
            id="new_password"
          >
            <input
              id="new_password"
              name="new_password"
              type="password"
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
            />
          </FormField>

          <button type="submit">
            {hasPassword ? "Update password" : "Set password"}
          </button>
        </form>
      </section>
    )}

    <section className="account-section card">
      <h2>Details</h2>
      <dl className="account-details">
        <dt>Role</dt>
        <dd>{user.role}</dd>
        <dt>Member since</dt>
        <dd>{formatDate(user.created_at)}</dd>
        <dt>Sign-in method</dt>
        <dd>
          {mode !== "password"
            ? "Magic link"
            : hasPassword
              ? "Email and password"
              : "Email and password (not set yet)"}
        </dd>
      </dl>
    </section>
  </Layout>
);
