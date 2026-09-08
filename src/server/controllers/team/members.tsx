import {
  isOrgRole,
  listMembers,
  type Member,
  removeMember,
  updateMemberRole,
} from "../../services/organizations";
import type { TeamState } from "../../templates/team";
import { formAction } from "../../utils/form-action";
import { readFormValues } from "../../utils/form-data";
import { type OrgAuthorized, orgRoleGuard } from "./guards";

/**
 * Resolve a member by id *within the caller's org*.
 *
 * The guard proves the caller administers some org, not that this row belongs
 * to it. Without the scoping, any org admin could re-role or evict any user in
 * the app — the one authorisation bug class this feature introduces that
 * nothing existing catches.
 */
const findInOrg = async (
  orgId: string,
  memberId: string,
): Promise<Member | null> => {
  const members = await listMembers(orgId);
  return members.find((member) => member.id === memberId) ?? null;
};

/**
 * The guarded UPDATE refused. "not-a-member" means the row went away between
 * the read above and the write — the same thing, to the person reading the
 * page, as it never having been there.
 */
const refusal = (
  error: "not-a-member" | "last-owner",
): NonNullable<TeamState["state"]> =>
  error === "last-owner" ? "last-owner" : "member-gone";

// Admins and above. A stale token flashes and never replays the action.
const memberAction = formAction<TeamState, OrgAuthorized>;

const adminOnly = {
  redirectTo: "/team",
  guard: orgRoleGuard("admin"),
  onExpired: () => ({ state: "action-csrf-expired" as const }),
};

export const teamMembers = {
  updateRole: memberAction(adminOnly)(async (req, _ctx, guard) => {
    const { org_role } = await readFormValues(req, ["org_role"]);

    if (!org_role || !isOrgRole(org_role)) {
      return { reject: 400, flash: { state: "invalid-role" } };
    }

    const orgId = guard.membership.org.id;
    const target = await findInOrg(orgId, req.params.id);

    // Not-found rather than 404 to the page, so "wrong org" and "already
    // gone" stay indistinguishable from the outside.
    if (!target) {
      return { reject: 404, flash: { state: "member-gone" } };
    }

    // Not your own role. The owner-only rule below already stops the upward
    // case, so the only self-change left is a demotion — which drops you below
    // the threshold this page requires and leaves you unable to undo it. A
    // trapdoor, and the same one removal was refused for.
    if (target.id === guard.ctx.user?.id) {
      return { reject: 403, flash: { state: "self-role-change" } };
    }

    // Only an owner may grant or revoke ownership. Without this an admin could
    // promote themselves, which makes the admin/owner distinction decorative.
    const touchesOwnership =
      target.org_role === "owner" || org_role === "owner";
    if (touchesOwnership && guard.membership.role !== "owner") {
      return { reject: 403, flash: { state: "owner-only" } };
    }

    const result = await updateMemberRole(orgId, target.id, org_role);

    if (!result.success) {
      return {
        reject: 409,
        flash: { state: refusal(result.error), email: target.email },
      };
    }

    return {
      flash: { state: "role-changed", email: target.email, org_role },
    };
  }),

  destroy: memberAction(adminOnly)(async (req, _ctx, guard) => {
    const orgId = guard.membership.org.id;
    const target = await findInOrg(orgId, req.params.id);

    if (!target) {
      return { reject: 404, flash: { state: "member-gone" } };
    }

    // Leaving your own team isn't a shipped action — see runbooks/TEAMS.md §8.
    // The members table hides Remove on your own row, and this is the server
    // saying the same thing, so the hidden control isn't the only thing
    // stopping it.
    if (target.id === guard.ctx.user?.id) {
      return { reject: 403, flash: { state: "self-removal" } };
    }

    if (target.org_role === "owner" && guard.membership.role !== "owner") {
      return { reject: 403, flash: { state: "owner-only" } };
    }

    const result = await removeMember(orgId, target.id);

    if (!result.success) {
      return {
        reject: 409,
        flash: { state: refusal(result.error), email: target.email },
      };
    }

    return { flash: { state: "member-removed", email: target.email } };
  }),
};
