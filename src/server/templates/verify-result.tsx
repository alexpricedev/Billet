import { AuthPage } from "../components/auth-page";
import { Flash } from "../components/flash";

export interface VerifyResultProps {
  status: "verified" | "invalid";
}

/**
 * The outcome of clicking an email confirmation link, on its own page.
 *
 * Deliberately not a redirect into /account: confirmation links are opened as
 * often from a phone or a mail client's browser as from the session that asked
 * for them, and an auth-gated destination would bounce those visitors to
 * /login with nothing to show for a token that has just been spent.
 *
 * The one call to action points at /account either way — it redirects to
 * /login when there's no session, so this page never has to know.
 */
export const VerifyResult = ({ status }: VerifyResultProps) => (
  <AuthPage
    title={
      status === "verified"
        ? "Email confirmed - Billet"
        : "Confirmation failed - Billet"
    }
    description="The result of confirming your Billet email address."
    canonicalPath="/auth/verify"
    heading={
      status === "verified" ? "Email confirmed" : "That link didn't work"
    }
    subtitle={
      status === "verified"
        ? "Your address is confirmed — nothing else to do"
        : "Confirmation links are single-use and expire after 24 hours"
    }
    footer={<a href="/">Back to home</a>}
  >
    {status === "verified" ? (
      <Flash type="success">
        <span>
          Thanks — we've confirmed this is your email address. You can close
          this tab.
        </span>
      </Flash>
    ) : (
      <Flash type="error">
        <span>
          This confirmation link is invalid, already used, or expired. Sign in
          and send yourself a new one from your account page.
        </span>
      </Flash>
    )}

    <p className="login-aside">
      <a href="/account">Go to your account</a>
    </p>
  </AuthPage>
);
