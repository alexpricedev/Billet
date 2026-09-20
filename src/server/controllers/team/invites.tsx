import type { BunRequest } from "bun";
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
import { type ActionGuard, formAction } from "../../utils/form-action";
import { readFormValues } from "../../utils/form-data";
import { fitFlashState } from "../../utils/state";
import { type OrgAuthorized, orgRoleGuard } from "./guards";

// Every request here can send an email, so it gets the same budget as /login
// and the verification resend rather than the default — before the org lookup,
// so a flood never reaches the database.
const adminWithEmailBudget: ActionGuard<OrgAuthorized> = async (
  req: BunRequest,
) => {
  if (!teamsEnabled()) return { ok: false, response: render404() };
  const limited = rateLimit(req, "auth", 5, 60_000);
  if (limited) return { ok: false, response: limited };
  return orgRoleGuard("admin")(req);
};

export const teamInvites = {
  create: formAction<TeamState, OrgAuthorized>({
    redirectTo: "/team",
    guard: adminWithEmailBudget,
    // Stale but authentic. The only thing worth preserving is the address,
    // which is safe to flash — the auth forms already round-trip one.
    onExpired: async (req) => {
      const { email } = await readFormValues(req, ["email"]);
      return fitFlashState<TeamState>({ state: "csrf-expired", email }, [
        "email",
      ]);
    },
  })(async (req, _ctx, guard) => {
    // readFormValues, not readPassword: trimming and dropping empties is right
    // for an address and a role, and nothing on this surface is a credential.
    // The field is named org_role, never role — a copy-paste that wrote this
    // into users.role would hand the invitee the /admin console.
    const { email, org_role } = await readFormValues(req, [
      "email",
      "org_role",
    ]);

    if (!email?.includes("@") || email.length > 254) {
      return { reject: 400, flash: { state: "invalid-email", email } };
    }

    // Owner is not offered: ownership is granted from the members table by an
    // existing owner, never handed out blind to an address that hasn't accepted.
    if (!org_role || !isOrgRole(org_role) || org_role === "owner") {
      return { reject: 400, flash: { state: "invalid-role", email } };
    }

    const result = await createInvite(
      guard.membership.org.id,
      email,
      org_role,
      guard.ctx.user?.id as string,
    );

    if (!result.success) {
      return { reject: 409, flash: { state: result.error, email } };
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
      return {
        reject: 502,
        flash: { state: "invite-failed", email: result.invite.email },
      };
    }

    return { flash: { state: "invite-sent", email: result.invite.email } };
  }),

  // Never replay a mutation on a recovered token — the plain post bounces back
  // so the row re-renders and the user confirms with a deliberate second click.
  destroy: formAction<TeamState, OrgAuthorized>({
    redirectTo: "/team",
    guard: orgRoleGuard("admin"),
    onExpired: () => ({ state: "action-csrf-expired" }),
  })(async (req, _ctx, guard) => {
    // Scoped to the caller's org inside revokeInvite: being an admin of some
    // org must not be enough to revoke another org's invite.
    const revoked = await revokeInvite(guard.membership.org.id, req.params.id);

    return { flash: { state: revoked ? "invite-revoked" : "invite-gone" } };
  }),
};
