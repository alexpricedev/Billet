import type { BunRequest } from "bun";
import { getSessionContext, requireAuth } from "../../middleware/auth";
import { checkCsrf, isRecoverableCsrfFailure } from "../../middleware/csrf";
import { createCsrfToken } from "../../services/csrf";
import { getEmailService } from "../../services/email";
import { log } from "../../services/logger";
import {
  createInvite,
  getOrganisationForUser,
  getOrganisationMembers,
  listPendingInvites,
  ORGANISATION_INVITE_EXPIRY_DAYS,
  revokeInvite,
} from "../../services/organisations";
import { organisationsEnabled } from "../../services/organisations-mode";
import type { OrganisationState } from "../../templates/organisation";
import { OrganisationPage } from "../../templates/organisation";
import { appUrl } from "../../utils/app-url";
import { render404 } from "../../utils/errors";
import { readFormValues } from "../../utils/form-data";
import { redirect, render } from "../../utils/response";
import { stateHelpers } from "../../utils/state";

const { getFlash, setFlash } = stateHelpers<OrganisationState>();

/**
 * The organisation a signed-in user belongs to, and the people in it.
 *
 * Every method 404s outside organisations mode. The route table is static, so a
 * route existing says nothing about whether it answers — same arrangement as the
 * password-mode routes.
 */
export const organisations = {
  async index(req: BunRequest): Promise<Response> {
    if (!organisationsEnabled()) return render404();

    const authRedirect = await requireAuth(req);
    if (authRedirect) return authRedirect;

    const ctx = await getSessionContext(req);
    if (!ctx.user || !ctx.sessionId) return redirect("/login");

    const membership = await getOrganisationForUser(ctx.user.id);
    // Only reachable if a membership was deleted out from under a live session:
    // the boot guard rules it out at startup, and nothing in the app creates a
    // user without one.
    if (!membership) return render404();

    const [members, invites, navCsrfToken, inviteCsrfToken] = await Promise.all(
      [
        getOrganisationMembers(membership.organisation.id),
        membership.role === "owner"
          ? listPendingInvites(membership.organisation.id)
          : Promise.resolve([]),
        createCsrfToken(ctx.sessionId, "POST", "/auth/logout"),
        membership.role === "owner"
          ? createCsrfToken(ctx.sessionId, "POST", "/organisation/invites")
          : Promise.resolve(null),
      ],
    );

    const revokeCsrfTokens: Record<string, string> = {};
    for (const invite of invites) {
      revokeCsrfTokens[invite.id] = await createCsrfToken(
        ctx.sessionId,
        "POST",
        `/organisation/invites/${invite.id}/delete`,
      );
    }

    return render(
      <OrganisationPage
        organisation={membership.organisation}
        role={membership.role}
        members={members}
        invites={invites}
        state={getFlash(req)}
        inviteCsrfToken={inviteCsrfToken}
        revokeCsrfTokens={revokeCsrfTokens}
        user={ctx.user}
        csrfToken={navCsrfToken}
      />,
    );
  },

  async invite(req: BunRequest): Promise<Response> {
    if (!organisationsEnabled()) return render404();

    const authRedirect = await requireAuth(req);
    if (authRedirect) return authRedirect;

    const ctx = await getSessionContext(req);
    if (!ctx.user || !ctx.sessionId) return redirect("/login");

    const csrf = await checkCsrf(req, {
      method: "POST",
      path: "/organisation/invites",
    });
    if (!csrf.ok) {
      if (!isRecoverableCsrfFailure(csrf)) return csrf.response;

      setFlash(req, { state: "csrf-expired" });
      return redirect("/organisation");
    }

    const membership = await getOrganisationForUser(ctx.user.id);
    if (!membership) return render404();

    // Membership alone isn't authority. A member who posts this form directly
    // must not be able to grow the organisation.
    if (membership.role !== "owner") {
      setFlash(req, {
        state: "validation-error",
        error: "Only an owner can invite people to this organisation.",
      });
      return redirect("/organisation");
    }

    const { email } = await readFormValues(req, ["email"]);

    if (!email || !email.includes("@")) {
      setFlash(req, {
        state: "validation-error",
        error: "Invalid email address",
        email,
      });
      return redirect("/organisation");
    }

    const result = await createInvite(
      membership.organisation.id,
      email,
      ctx.user.id,
    );

    if (!result.success) {
      setFlash(req, {
        state: "validation-error",
        error:
          result.error === "already-member"
            ? "That person is already in this organisation."
            : "There is already an open invitation for that address.",
        email,
      });
      return redirect("/organisation");
    }

    // The invitation exists whether or not the mail lands. Losing the session
    // over a mail failure would be worse than a revoke-and-resend.
    try {
      await getEmailService().sendOrganisationInvite({
        to: { email: result.invite.email },
        organisationName: membership.organisation.name,
        invitedByEmail: ctx.user.email,
        acceptUrl: appUrl(`/invites/accept?token=${result.rawToken}`),
        expiryDays: ORGANISATION_INVITE_EXPIRY_DAYS,
      });
    } catch (error) {
      log.error("organisations", `failed to send invite email: ${error}`);
    }

    setFlash(req, { state: "invite-sent" });
    return redirect("/organisation");
  },

  async revokeInvite<T extends `${string}:id${string}`>(
    req: BunRequest<T>,
  ): Promise<Response> {
    if (!organisationsEnabled()) return render404();

    const authRedirect = await requireAuth(req);
    if (authRedirect) return authRedirect;

    const ctx = await getSessionContext(req);
    if (!ctx.user) return redirect("/login");

    const csrf = await checkCsrf(req, {
      method: "POST",
      path: new URL(req.url).pathname,
    });
    if (!csrf.ok) {
      if (!isRecoverableCsrfFailure(csrf)) return csrf.response;

      setFlash(req, { state: "csrf-expired" });
      return redirect("/organisation");
    }

    const membership = await getOrganisationForUser(ctx.user.id);
    if (!membership || membership.role !== "owner") return render404();

    // Scoped to the caller's organisation inside the service, so an owner can't
    // revoke an invitation belonging to someone else's.
    if (await revokeInvite(membership.organisation.id, req.params.id)) {
      setFlash(req, { state: "invite-revoked" });
    }

    return redirect("/organisation");
  },
};
