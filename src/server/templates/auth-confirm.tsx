import { AuthPage } from "../components/auth-page";
import { CsrfField } from "../components/csrf-field";
import { Flash } from "../components/flash";

export const CALLBACK_PATH = "/auth/callback";
export const VERIFY_PATH = "/auth/verify";

// Which link the visitor arrived on. Sign-in mints a session, confirmation
// only stamps the address — the copy and the CSRF rules differ on that.
export type ConfirmIntent = "sign-in" | "email-verification";

export interface AuthConfirmProps {
  intent: ConfirmIntent;
  token: string;
  // Null in the sign-in case means no session could be started, which is a
  // dead end worth naming. Email confirmation submits without one — see below.
  csrfToken: string | null;
}

const COPY = {
  "sign-in": {
    title: "Confirm sign in - Billet",
    description: "Finish signing in to Billet.",
    canonicalPath: CALLBACK_PATH,
    heading: "Confirm sign in",
    subtitle: "Your link works once, so we ask before spending it",
    submit: "Sign in",
  },
  "email-verification": {
    title: "Confirm your email - Billet",
    description: "Confirm your email address for Billet.",
    canonicalPath: VERIFY_PATH,
    heading: "Confirm your email",
    subtitle: "Your link works once, so we ask before spending it",
    submit: "Confirm my email",
  },
} as const;

/**
 * The click-to-continue step between a single-use link and the thing it spends.
 *
 * Corporate mail filters (Microsoft Defender Safe Links and friends) fetch
 * every link they deliver, and a fetch is enough to burn a single-use token —
 * so the recipient clicks a link that has already been spent and lands on a
 * page that can't explain why. Redemption therefore happens on this form's
 * POST: scanners follow links, they don't submit forms.
 *
 * Sign-in POSTs are CSRF-checked, because a cross-site auto-submit there would
 * be login CSRF — dropping a visitor into a session they didn't ask for.
 * Confirming an address creates no session and the token is the only thing
 * being presented, so that form is deliberately submittable without one; it has
 * to work from a mail client's browser that keeps no cookies at all.
 */
export const AuthConfirm = ({ intent, token, csrfToken }: AuthConfirmProps) => {
  const copy = COPY[intent];
  const needsCsrf = intent === "sign-in";

  return (
    <AuthPage
      title={copy.title}
      description={copy.description}
      canonicalPath={copy.canonicalPath}
      heading={copy.heading}
      subtitle={copy.subtitle}
      footer={<a href="/">Back to home</a>}
    >
      {needsCsrf && !csrfToken ? (
        <Flash type="error">
          <span>
            We couldn't start a session in your browser. Check that cookies are
            enabled and open the link again.
          </span>
        </Flash>
      ) : (
        <form method="POST" action={copy.canonicalPath}>
          <CsrfField token={csrfToken} />
          {/* In the body rather than the action URL, so it stays out of the
              Referer header when a browser follows a link off this page. */}
          <input type="hidden" name="token" value={token} />

          <button type="submit" className="login-submit">
            {copy.submit}
          </button>
        </form>
      )}
    </AuthPage>
  );
};
