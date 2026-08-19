import type { BunRequest } from "bun";
import { getSessionContext } from "../../middleware/auth";
import { checkCsrf } from "../../middleware/csrf";
import { rateLimit } from "../../middleware/rate-limit";
import { findUserByEmail, regenerateSession } from "../../services/auth";
import { passwordAuthEnabled } from "../../services/auth-mode";
import { captchaEnabled, issueChallenge } from "../../services/captcha";
import { createCsrfToken } from "../../services/csrf";
import { acceptInvite, peekInvite } from "../../services/invites";
import { log } from "../../services/logger";
import { setInitialPassword, userHasPassword } from "../../services/passwords";
import { setSessionCookie } from "../../services/sessions";
import { teamsEnabled } from "../../services/teams-mode";
import type { AcceptInviteState } from "../../templates/accept-invite";
import { AcceptInvite } from "../../templates/accept-invite";
import { render404 } from "../../utils/errors";
import { setFlashCookie } from "../../utils/flash";
import { redirect, render } from "../../utils/response";
import { stateHelpers } from "../../utils/state";
import { guardAuthForm, readPassword } from "../auth/form-guard";

const { getFlash, setFlash } = stateHelpers<AcceptInviteState>();

export const invite = {
  async index(req: BunRequest): Promise<Response> {
    if (!teamsEnabled()) return render404();

    const limited = rateLimit(req, 10, 60_000);
    if (limited) return limited;

    const token = new URL(req.url).searchParams.get("token") ?? "";
    const state = getFlash(req);

    // Unlike /reset-password, this GET *does* look the invite up without
    // spending it. That page is byte-identical either way, so a peek there
    // would only sort real tokens from guesses; this page genuinely differs —
    // it names the team, and in password mode it decides whether to ask for a
    // password — so a page that works is worth the narrow oracle against a
    // 256-bit token on a rate-limited route.
    const preview = token ? await peekInvite(token) : null;

    // Nothing live behind this URL. Rendered, never redirected: this *is*
    // where deadEnd sends a refused POST, so a redirect here would point at
    // itself and loop until the browser or the rate limiter gave up.
    if (!preview) return unavailable(state);

    const ctx = await getSessionContext(req);

    // Accepting under the wrong session is the likeliest footgun here, so it
    // gets its own rendering with a way out rather than a failed submit.
    if (ctx.user && ctx.user.email !== preview.email) {
      return render(
        <AcceptInvite
          token={token}
          preview={preview}
          state={{ state: "email-mismatch" }}
          signedInAs={ctx.user.email}
          needsPassword={false}
          csrfToken={null}
          logoutCsrfToken={
            ctx.sessionId
              ? await createCsrfToken(ctx.sessionId, "POST", "/auth/logout")
              : null
          }
          challenge={null}
        />,
      );
    }

    const needsPassword = await needsNewPassword(preview.email);

    // Gated on captchaEnabled() alone, never on needsPassword as well:
    // guardAuthForm verifies the solution on every POST this form makes, so a
    // page rendered without the widget is one nobody can submit.
    const challenge = captchaEnabled() ? issueChallenge() : null;

    return render(
      <AcceptInvite
        token={token}
        preview={preview}
        state={state}
        signedInAs={ctx.user?.email ?? null}
        needsPassword={needsPassword}
        csrfToken={
          ctx.sessionId
            ? await createCsrfToken(ctx.sessionId, "POST", "/invites/accept")
            : null
        }
        logoutCsrfToken={null}
        challenge={challenge}
      />,
    );
  },

  async create(req: BunRequest): Promise<Response> {
    if (!teamsEnabled()) return render404();

    const ctx = await getSessionContext(req);

    // A signed-in visitor has a session to bind a CSRF token to, so the check
    // applies. A signed-out one is accepting from an emailed link with no
    // prior session — guardAuthForm below is that path's defence, exactly as
    // it is for /signup.
    if (ctx.isAuthenticated) {
      const csrf = await checkCsrf(req, {
        method: "POST",
        path: "/invites/accept",
      });
      if (!csrf.ok) return csrf.response;
    }

    // Rate limit, honeypot and captcha — this form can create an account, so it
    // gets the same layered defence as the other unauthenticated auth forms.
    const guard = await guardAuthForm(req);

    if (!guard.ok) {
      if (guard.reason === "rate-limited") return guard.response;

      // A stale challenge must not cost someone their invite: nothing has been
      // spent, so put them back on the same link.
      const attempted = guard.formData.get("token");
      return typeof attempted === "string" && attempted
        ? retryWithToken(
            req,
            attempted,
            "Verification failed. Please try again.",
          )
        : deadEnd(req, "invalid-token");
    }

    const token = guard.formData.get("token");
    if (typeof token !== "string" || !token) {
      return deadEnd(req, "invalid-token");
    }

    const preview = await peekInvite(token);
    if (!preview) return deadEnd(req, "invalid-token");

    const needsPassword = await needsNewPassword(preview.email);

    // Validate the password *before* the invite is consumed, mirroring
    // resetPassword: a too-short password must not burn a single-use token.
    const password = needsPassword
      ? readPassword(guard.formData, "password")
      : "";

    if (needsPassword && (password.length < 8 || password.length > 128)) {
      return retryWithToken(
        req,
        token,
        "Password must be between 8 and 128 characters.",
      );
    }

    const result = await acceptInvite(token, ctx.user?.id ?? null);

    if (!result.success) {
      // A mismatch is checked before the token is spent, so the link still
      // works — send them back to it rather than to the dead end, and the GET
      // renders the mismatch with the sign-out button that resolves it.
      return result.error === "email-mismatch"
        ? redirect(`/invites/accept?token=${encodeURIComponent(token)}`)
        : deadEnd(req, result.error);
    }

    if (!needsPassword) {
      // Two very different cases land here.
      //
      // In magic-link mode the emailed token *is* the credential, so signing
      // them in is exactly what a magic link does. And someone who arrived
      // already signed in is, by definition, already authenticated.
      if (!passwordAuthEnabled() || ctx.isAuthenticated) {
        return await finish(req, result.user.id, result.organization.name, ctx);
      }

      // Password mode, signed out, and the invited address already has a
      // password. They are now a member, but control of a mailbox is grounds
      // for a *reset*, never a sign-in — which is precisely why /auth/verify
      // signs nobody in. An invite must not become a way around that.
      setFlashCookie(req, "message", {
        text: `You've joined ${result.organization.name}. Sign in to continue.`,
        type: "success",
      });
      return redirect("/login");
    }

    const set = await setInitialPassword(result.user.id, password);

    if (!set.success) {
      // "already-set" means a password landed between the check above and this
      // write — a second tab, or a reset finishing mid-flow. Same answer as the
      // existing-account branch: they are a member, they sign in normally.
      if (set.error === "already-set") {
        setFlashCookie(req, "message", {
          text: `You've joined ${result.organization.name}. Sign in to continue.`,
          type: "success",
        });
        return redirect("/login");
      }

      // The invite is spent and the password didn't stick. Say so rather than
      // signing them in on a credential they never successfully chose.
      log.error("invite", `failed to set password after accept: ${set.error}`);
      setFlashCookie(req, "message", {
        text: `You've joined ${result.organization.name}, but your password wasn't set. Use "Forgot password" to choose one.`,
        type: "warning",
      });
      return redirect("/login");
    }

    return await finish(req, result.user.id, result.organization.name, ctx);
  },
};

/**
 * Whether password mode has to ask this invitee to choose a credential.
 *
 * Keyed on the *invited address*, not the session: most people accept an
 * invitation signed out, so there is no session user to ask, and deciding from
 * one would demand a password from an account that already has one — and then
 * reject the accept for a missing password it should never have wanted.
 */
const needsNewPassword = async (email: string): Promise<boolean> => {
  if (!passwordAuthEnabled()) return false;

  const existing = await findUserByEmail(email);

  return !existing || !(await userHasPassword(existing.id));
};

/**
 * Sign the new member in and land them somewhere useful.
 *
 * regenerateSession rather than reusing whatever cookie arrived: an attacker
 * who planted a session id would otherwise ride it once it gained a membership.
 */
const finish = async (
  req: BunRequest,
  userId: string,
  orgName: string,
  ctx: { sessionId: string | null },
): Promise<Response> => {
  const sessionId = await regenerateSession(userId, ctx.sessionId);
  setSessionCookie(req, sessionId);

  // A new member joins below the /team threshold, so send them home rather
  // than to a page the guard would bounce them from.
  setFlashCookie(req, "message", {
    text: `You've joined ${orgName}`,
    type: "success",
  });
  return redirect("/");
};

/**
 * The token is gone, spent, or not theirs — only a new invite gets them back.
 *
 * A refused POST redirects rather than rendering, so a reload can't resubmit
 * it; the GET it lands on renders the page below from the flash.
 */
const deadEnd = (
  req: BunRequest,
  state: AcceptInviteState["state"],
): Response => {
  setFlash(req, { state });
  return redirect("/invites/accept");
};

// Only these say something a visitor with no live invite can act on. Anything
// else — a stale "validation-error" from a form whose token has since been
// spent — means the same thing to them as an unknown token.
const DEAD_END_STATES = ["invalid-token", "already-in-org"] as const;

/** The "Invitation unavailable" page: no live invite behind the URL. */
const unavailable = (state?: AcceptInviteState): Response =>
  render(
    <AcceptInvite
      token=""
      preview={null}
      state={{
        state: DEAD_END_STATES.some((known) => known === state?.state)
          ? state?.state
          : "invalid-token",
      }}
      signedInAs={null}
      needsPassword={false}
      csrfToken={null}
      logoutCsrfToken={null}
      challenge={null}
    />,
  );

/** Recoverable: the token is untouched, so re-render the form behind it. */
const retryWithToken = (
  req: BunRequest,
  token: string,
  error: string,
): Response => {
  setFlash(req, { state: "validation-error", error });
  return redirect(`/invites/accept?token=${encodeURIComponent(token)}`);
};
