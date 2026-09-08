import type { BunRequest } from "bun";
import { type OrgResult, requireOrgRole } from "../../middleware/org";
import type { OrgRole } from "../../services/organizations";
import { teamsEnabled } from "../../services/teams-mode";
import { render404 } from "../../utils/errors";
import type { ActionGuard } from "../../utils/form-action";

export type OrgAuthorized = Extract<OrgResult, { authorized: true }>;

// `requireOrgRole` as a `formAction` guard. The teamsEnabled() check is
// repeated here on purpose — see the note on `requireOrgRole`: the line a
// fork reads is the one at the top of the controller, and the copy inside the
// middleware is the backstop.
export const orgRoleGuard =
  (minimum: OrgRole): ActionGuard<OrgAuthorized> =>
  async (req: BunRequest) => {
    if (!teamsEnabled()) return { ok: false, response: render404() };

    const guard = await requireOrgRole(req, minimum);
    if (!guard.authorized) return { ok: false, response: guard.response };
    return { ok: true, value: guard, ctx: guard.ctx };
  };
