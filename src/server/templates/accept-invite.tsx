import { AuthPage } from "../components/auth-page";
import { CsrfField } from "../components/csrf-field";
import { Flash } from "../components/flash";
import { FormField } from "../components/form-field";
import type { AuthMode } from "../services/auth-mode";
import { MIN_PASSWORD_LENGTH } from "../services/passwords";

export interface AcceptInviteState {
  state?: "validation-error";
  error?: string;
}

export interface AcceptInviteProps {
  mode: AuthMode;
  // The address the invitation was sent to. Shown, never edited: accepting binds
  // the new account to this address, so letting it be typed would turn an
  // invitation into a way to create an account at any address at all.
  email: string;
  organisationName: string;
  token: string;
  state?: AcceptInviteState;
  // True when the visitor is already signed in, in which case accepting is one
  // button and no account is created.
  signedIn?: boolean;
  // Only present for a signed-in visitor — a signed-out one has no session
  // secret to sign a token with.
  csrfToken?: string | null;
}

export const AcceptInvite = ({
  mode,
  email,
  organisationName,
  token,
  state,
  signedIn = false,
  csrfToken = null,
}: AcceptInviteProps) => {
  const password = mode === "password" && !signedIn;

  return (
    <AuthPage
      title={`Join ${organisationName} - Billet`}
      description={`Accept your invitation to join ${organisationName}.`}
      canonicalPath="/invites/accept"
      heading={`Join ${organisationName}`}
      subtitle={
        signedIn
          ? `Accept this invitation to join ${organisationName}`
          : `Invitation sent to ${email}`
      }
      footer={<a href="/">Back to home</a>}
    >
      <form method="POST" action="/invites/accept">
        {state?.state === "validation-error" && state.error && (
          <Flash type="error">
            <span>{state.error}</span>
          </Flash>
        )}

        <CsrfField token={csrfToken} />
        <input type="hidden" name="token" value={token} />

        {!signedIn && (
          <FormField label="Email address" id="email">
            {/* Disabled rather than hidden: the recipient should see which
                address they are accepting as, and a disabled field is not
                submitted, so the server keeps using the invitation's own. */}
            <input id="email" type="email" value={email} disabled />
          </FormField>
        )}

        {password && (
          <FormField label="Choose a password" id="password">
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

        <button type="submit" className="login-submit">
          {signedIn ? `Join ${organisationName}` : "Accept invitation"}
        </button>
      </form>
    </AuthPage>
  );
};
