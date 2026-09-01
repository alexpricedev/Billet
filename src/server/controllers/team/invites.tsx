import type { BunRequest } from "bun";
import { checkCsrf, isRecoverableCsrfFailure } from "../../middleware/csrf";
import { requireOrgRole } from "../../middleware/org";
import { rateLimit } from "../../middleware/rate-limit";
import { getEmailService } from "../../services/email";
import {
  createInvite,
  ORG_INVITE_EXPIRY_DAYS,
  revokeInvite,
} from "../../services/invites";
import { log } from "../../services/logger";
import { isOrgRole } from "../../services/organizations";
import { teamsEnabled } from "../../services/teams-mode";
import type { TeamState } from "../../templates/team";
import { appUrl } from "../../utils/app-url";
import { render404 } from "../../utils/errors";
import { readFormValues } from "../../utils/form-data";
import { redirect } from "../../utils/response";
import { fitFlashState, stateHelpers } from "../../utils/state";

const { setFlash } = stateHelpers<TeamState>();

export const teamInvites = {
  async create(req: BunRequest): Promise<Response> {
    if (!teamsEnabled()) return render404();

    // Every request here can send an email, so it gets the same budget as
    // /login and the verification resend rather than the default.
    const limited = rateLimit(req, "auth", 5, 60_000);
    if (limited) return limited;

    const guard = await requireOrgRole(req, "admin");
    if (!guard.authorized) return guard.response;

    const csrf = await checkCsrf(req, {
      method: "POST",
      path: "/team/invites",
    });
    if (!csrf.ok) {
      if (!isRecoverableCsrfFailure(csrf)) return csrf.response;

      // Stale but authentic. The only thing worth preserving is the address,
      // which is safe to flash — the auth forms already round-trip one.
      const stale = await readFormValues(req, ["email"]);
      setFlash(
        req,
        fitFlashState<TeamState>(
          { state: "csrf-expired", email: stale.email },
          ["email"],
        ),
      );
      return redirect("/team");
    }

    // readFormValues, not readPassword: trimming and dropping empties is right
    // for an address and a role, and nothing on this surface is a credential.
    // The field is named org_role, never role — a copy-paste that wrote this
    // into users.role would hand the invitee the /admin console.
    const { email, org_role } = await readFormValues(req, [
      "email",
      "org_role",
    ]);

    if (!email || !email.includes("@") || email.length > 254) {
      setFlash(req, { state: "invalid-email", email });
      return redirect("/team");
    }

    // Owner is not offered: ownership is granted from the members table by an
    // existing owner, never handed out blind to an address that hasn't accepted.
    if (!org_role || !isOrgRole(org_role) || org_role === "owner") {
      setFlash(req, { state: "invalid-role", email });
      return redirect("/team");
    }

    const result = await createInvite(
      guard.membership.org.id,
      email,
      org_role,
      guard.ctx.user?.id as string,
    );

    if (!result.success) {
      setFlash(req, { state: result.error, email });
      return redirect("/team");
    }

    // Unlike the password reset, a send failure here is reported. That silence
    // exists to hide whether an account exists; there is no such concern when
    // an authenticated admin chose the address themselves, and staying quiet
    // would leave them waiting on mail that never went.
    try {
      await getEmailService().sendOrgInvite({
        to: { email: result.invite.email },
        organizationName: guard.membership.org.name,
        invitedByEmail: guard.ctx.user?.email as string,
        acceptUrl: appUrl(`/invites/accept?token=${result.rawToken}`),
        expiryDays: ORG_INVITE_EXPIRY_DAYS,
      });
    } catch (error) {
      log.error("team", `Failed to send invite email: ${error}`);
      setFlash(req, { state: "invite-failed", email: result.invite.email });
      return redirect("/team");
    }

    setFlash(req, { state: "invite-sent", email: result.invite.email });
    return redirect("/team");
  },

  async destroy(req: BunRequest): Promise<Response> {
    if (!teamsEnabled()) return render404();

    const guard = await requireOrgRole(req, "admin");
    if (!guard.authorized) return guard.response;

    const csrf = await checkCsrf(req, {
      method: "POST",
      path: new URL(req.url).pathname,
    });
    if (!csrf.ok) {
      if (!isRecoverableCsrfFailure(csrf)) return csrf.response;

      // Never replay a mutation on a recovered token — bounce back so the row
      // re-renders and the user confirms with a deliberate second click.
      setFlash(req, { state: "action-csrf-expired" });
      return redirect("/team");
    }

    // Scoped to the caller's org inside revokeInvite: being an admin of some
    // org must not be enough to revoke another org's invite.
    const revoked = await revokeInvite(guard.membership.org.id, req.params.id);

    setFlash(req, { state: revoked ? "invite-revoked" : "invite-gone" });
    return redirect("/team");
  },
};
