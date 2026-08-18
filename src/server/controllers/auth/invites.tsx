import type { BunRequest } from "bun";
import { getSessionContext } from "../../middleware/auth";
import { checkCsrf } from "../../middleware/csrf";
import { rateLimit } from "../../middleware/rate-limit";
import { regenerateSession } from "../../services/auth";
import { authMode, passwordAuthEnabled } from "../../services/auth-mode";
import { createCsrfToken } from "../../services/csrf";
import { log } from "../../services/logger";
import {
  addMember,
  consumeInvite,
  findPendingInvite,
  signUpIntoOrganisation,
} from "../../services/organisations";
import { organisationsEnabled } from "../../services/organisations-mode";
import { validatePassword } from "../../services/passwords";
import {
  getSessionIdFromRequest,
  setSessionCookie,
} from "../../services/sessions";
import type { AcceptInviteState } from "../../templates/accept-invite";
import { AcceptInvite } from "../../templates/accept-invite";
import { hashPassword } from "../../utils/crypto";
import { render404 } from "../../utils/errors";
import { redirect, render } from "../../utils/response";
import { stateHelpers } from "../../utils/state";
import { readPassword } from "./form-guard";

const { getFlash, setFlash } = stateHelpers<AcceptInviteState>();

const ACCEPT_PATH = "/invites/accept";

const acceptUrlFor = (token: string) =>
  `${ACCEPT_PATH}?token=${encodeURIComponent(token)}`;

/**
 * Accepting an invitation into an organisation.
 *
 * The account is always created with the address the invitation was sent to,
 * never one supplied by the form — otherwise an invitation would be a way to
 * create an account at an arbitrary address.
 *
 * Both methods 404 outside organisations mode.
 */
export const invites = {
  async edit(req: BunRequest): Promise<Response> {
    if (!organisationsEnabled()) return render404();

    const token = new URL(req.url).searchParams.get("token");
    if (!token) return render404();

    const invite = await findPendingInvite(token);
    // Expired, already accepted, revoked, or never real — all the same to
    // whoever holds the link. Distinguishing them would confirm that an address
    // was invited to a named organisation.
    if (!invite) return render404();

    const ctx = await getSessionContext(req);

    // Signed-in acceptance is a state change made by an existing session, so it
    // carries a CSRF token. The signed-out path has no session secret to sign
    // with and is protected by the unguessable invite token plus a rate limit,
    // exactly as /signup is.
    const csrfToken =
      ctx.isAuthenticated && ctx.sessionId
        ? await createCsrfToken(ctx.sessionId, "POST", ACCEPT_PATH)
        : null;

    return render(
      <AcceptInvite
        mode={authMode()}
        email={invite.email}
        organisationName={invite.organisation_name}
        token={token}
        state={getFlash(req)}
        signedIn={ctx.isAuthenticated}
        csrfToken={csrfToken}
      />,
    );
  },

  async update(req: BunRequest): Promise<Response> {
    if (!organisationsEnabled()) return render404();

    const limited = rateLimit(req, 5, 60_000);
    if (limited) return limited;

    const ctx = await getSessionContext(req);

    // Before the body is read: checkCsrf inspects a clone, leaving it unspent.
    if (ctx.isAuthenticated) {
      const csrf = await checkCsrf(req, { method: "POST", path: ACCEPT_PATH });
      if (!csrf.ok) return csrf.response;
    }

    const formData = await req.formData();
    const token = formData.get("token");
    if (typeof token !== "string" || !token) return render404();

    // A signed-in visitor joins as themselves. Which address the invitation was
    // sent to decides which organisation they may join, not who they are.
    if (ctx.isAuthenticated && ctx.user) {
      const invite = await consumeInvite(token);
      if (!invite) return render404();

      if (!(await addMember(invite.organisation_id, ctx.user.id))) {
        // Already in an organisation. The invitation is spent either way: the
        // claim was genuine and single-use, it just can't be honoured.
        setFlash(req, {
          state: "validation-error",
          error:
            "You already belong to an organisation, so you can't join another.",
        });
        return redirect(acceptUrlFor(token));
      }

      return redirect("/organisation");
    }

    // A new account. Validate before claiming so a rejected password doesn't
    // burn the invitation.
    let passwordHash: string | null = null;

    if (passwordAuthEnabled()) {
      const password = readPassword(formData, "password");
      const passwordError = validatePassword(password);

      if (passwordError) {
        setFlash(req, { state: "validation-error", error: passwordError });
        return redirect(acceptUrlFor(token));
      }

      passwordHash = await hashPassword(password);
    }

    // Claimed before the account is built. A burned invitation with no account
    // is recoverable — the owner sends another — whereas an account with no
    // organisation is what the boot guard refuses to start on.
    const invite = await consumeInvite(token);
    if (!invite) return render404();

    const result = await signUpIntoOrganisation(
      invite.email,
      invite.organisation_id,
      passwordHash,
    );

    if (!result.success) {
      // Invited at an address that already has an account. They need to sign in
      // and accept, but this invitation is spent, so the owner sends a new one.
      log.warn(
        "invites",
        "invitation accepted for an address that already has an account",
      );
      setFlash(req, {
        state: "validation-error",
        error:
          "An account already exists for that address. Sign in first, then ask for a new invitation.",
      });
      return redirect(acceptUrlFor(token));
    }

    const sessionId = await regenerateSession(
      result.user.id,
      getSessionIdFromRequest(req),
    );
    setSessionCookie(req, sessionId);

    return redirect("/organisation");
  },
};
