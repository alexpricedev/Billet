import { AuthPage } from "../components/auth-page";
import { CaptchaWidget } from "../components/captcha-widget";
import { CsrfField } from "../components/csrf-field";
import { Flash } from "../components/flash";
import { FormField } from "../components/form-field";
import { Honeypot } from "../components/honeypot";
import type { CaptchaChallenge } from "../services/captcha";
import type { InvitePreview } from "../services/invites";
import { MIN_PASSWORD_LENGTH } from "../services/passwords";

export interface AcceptInviteState {
  state?:
    | "validation-error"
    | "invalid-token"
    | "email-mismatch"
    | "already-in-org";
  error?: string;
}

export interface AcceptInviteProps {
  token: string;
  preview: InvitePreview | null;
  state?: AcceptInviteState;
  signedInAs: string | null;
  // Password mode only, and only when the account doesn't have one yet.
  needsPassword: boolean;
  csrfToken: string | null;
  logoutCsrfToken: string | null;
  challenge?: CaptchaChallenge | null;
}

export const AcceptInvite = ({
  token,
  preview,
  state,
  signedInAs,
  needsPassword,
  csrfToken,
  logoutCsrfToken,
  challenge,
}: AcceptInviteProps) => (
  <AuthPage
    title="Accept your invitation - Billet"
    description="Join a team you've been invited to."
    canonicalPath="/invites/accept"
    heading={
      preview ? `Join ${preview.organizationName}` : "Invitation unavailable"
    }
    subtitle={
      preview && state?.state !== "email-mismatch"
        ? `You've been invited as ${preview.org_role}`
        : "Ask whoever invited you to send a new link"
    }
    footer={<a href="/login">Back to sign in</a>}
  >
    {state?.state === "invalid-token" && (
      <Flash type="error">
        <span>
          That invitation link is invalid, has expired, or has already been
          used. Ask whoever invited you to send another.
        </span>
      </Flash>
    )}

    {state?.state === "already-in-org" && (
      <Flash type="error">
        <span>
          You're already in a team. Leave that team before accepting this
          invitation.
        </span>
      </Flash>
    )}

    {/* The likeliest footgun: clicking a forwarded link, or one meant for
        another of your addresses, while signed in as someone else. Accepting
        it must not silently bind the invite to the wrong account. */}
    {state?.state === "email-mismatch" && preview && (
      <>
        <Flash type="error">
          <span>
            This invitation was sent to {preview.email}, but you're signed in as{" "}
            {signedInAs}. Sign out and open the link again.
          </span>
        </Flash>
        {logoutCsrfToken && (
          <form className="invite-form" method="POST" action="/auth/logout">
            <CsrfField token={logoutCsrfToken} />
            <button type="submit">Sign out</button>
          </form>
        )}
      </>
    )}

    {preview && !state?.state && (
      <form className="invite-form" method="POST" action="/invites/accept">
        {/* The token travels in the form rather than the action URL so it stays
            out of the Referer header when the browser follows a link from this
            page. */}
        <input type="hidden" name="token" value={token} />
        {csrfToken && <CsrfField token={csrfToken} />}

        <p>
          You've been invited to join{" "}
          <strong>{preview.organizationName}</strong> as {preview.email}.
        </p>

        {needsPassword && (
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

        <Honeypot />
        {challenge && <CaptchaWidget challenge={challenge} />}

        <button type="submit">Accept invitation</button>
      </form>
    )}

    {preview && state?.state === "validation-error" && (
      <form className="invite-form" method="POST" action="/invites/accept">
        <Flash type="error">
          <span>{state.error}</span>
        </Flash>

        <input type="hidden" name="token" value={token} />
        {csrfToken && <CsrfField token={csrfToken} />}

        {needsPassword && (
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

        <Honeypot />
        {challenge && <CaptchaWidget challenge={challenge} />}

        <button type="submit">Accept invitation</button>
      </form>
    )}
  </AuthPage>
);
