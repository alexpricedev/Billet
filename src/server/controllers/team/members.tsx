import type { BunRequest } from "bun";
import { checkCsrf, isRecoverableCsrfFailure } from "../../middleware/csrf";
import { requireOrgRole } from "../../middleware/org";
import {
  isOrgRole,
  listMembers,
  type Member,
  removeMember,
  updateMemberRole,
} from "../../services/organizations";
import { teamsEnabled } from "../../services/teams-mode";
import type { TeamState } from "../../templates/team";
import { render404 } from "../../utils/errors";
import { setFlashCookie } from "../../utils/flash";
import { readFormValues } from "../../utils/form-data";
import { redirect } from "../../utils/response";
import { stateHelpers } from "../../utils/state";

const { setFlash } = stateHelpers<TeamState>();

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

export const teamMembers = {
  async updateRole<T extends `${string}:id${string}`>(
    req: BunRequest<T>,
  ): Promise<Response> {
    if (!teamsEnabled()) return render404();

    const guard = await requireOrgRole(req, "admin");
    if (!guard.authorized) return guard.response;

    const csrf = await checkCsrf(req, {
      method: "POST",
      path: new URL(req.url).pathname,
    });
    if (!csrf.ok) {
      if (!isRecoverableCsrfFailure(csrf)) return csrf.response;

      setFlash(req, { state: "action-csrf-expired" });
      return redirect("/team");
    }

    const { org_role } = await readFormValues(req, ["org_role"]);

    if (!org_role || !isOrgRole(org_role)) {
      setFlash(req, { state: "invalid-role" });
      return redirect("/team");
    }

    const orgId = guard.membership.org.id;
    const target = await findInOrg(orgId, req.params.id);

    // Not-found rather than 404, so "wrong org" and "already gone" stay
    // indistinguishable from the outside.
    if (!target) {
      setFlash(req, { state: "member-gone" });
      return redirect("/team");
    }

    // Only an owner may grant or revoke ownership. Without this an admin could
    // promote themselves, which makes the admin/owner distinction decorative.
    const touchesOwnership =
      target.org_role === "owner" || org_role === "owner";
    if (touchesOwnership && guard.membership.role !== "owner") {
      setFlash(req, { state: "owner-only" });
      return redirect("/team");
    }

    const result = await updateMemberRole(orgId, target.id, org_role);

    if (!result.success) {
      setFlash(req, { state: refusal(result.error), email: target.email });
      return redirect("/team");
    }

    setFlash(req, {
      state: "role-changed",
      email: target.email,
      org_role,
    });
    return redirect("/team");
  },

  async destroy<T extends `${string}:id${string}`>(
    req: BunRequest<T>,
  ): Promise<Response> {
    if (!teamsEnabled()) return render404();

    const guard = await requireOrgRole(req, "admin");
    if (!guard.authorized) return guard.response;

    const csrf = await checkCsrf(req, {
      method: "POST",
      path: new URL(req.url).pathname,
    });
    if (!csrf.ok) {
      if (!isRecoverableCsrfFailure(csrf)) return csrf.response;

      setFlash(req, { state: "action-csrf-expired" });
      return redirect("/team");
    }

    const orgId = guard.membership.org.id;
    const target = await findInOrg(orgId, req.params.id);

    if (!target) {
      setFlash(req, { state: "member-gone" });
      return redirect("/team");
    }

    if (target.org_role === "owner" && guard.membership.role !== "owner") {
      setFlash(req, { state: "owner-only" });
      return redirect("/team");
    }

    const result = await removeMember(orgId, target.id);

    if (!result.success) {
      setFlash(req, { state: refusal(result.error), email: target.email });
      return redirect("/team");
    }

    // Leaving the team yourself: /team would immediately bounce you back
    // through the guard with a confusing "you're not in a team", so land on
    // the homepage instead — which means the "message" key rather than the
    // team page's own flash state. No session invalidation: this is identity
    // management, not account deletion.
    if (target.id === guard.ctx.user?.id) {
      setFlashCookie(req, "message", {
        text: `You've left ${guard.membership.org.name}`,
      });
      return redirect("/");
    }

    setFlash(req, { state: "member-removed", email: target.email });
    return redirect("/team");
  },
};
