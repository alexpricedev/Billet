import type { BunRequest } from "bun";
import { getSessionContext, requireAuth } from "../../middleware/auth";
import { requireOrgRole } from "../../middleware/org";
import { listInvites } from "../../services/invites";
import {
  createOrganizationForUser,
  getMembership,
  listMembers,
  validateOrgName,
} from "../../services/organizations";
import { setSessionCookie } from "../../services/sessions";
import { teamsEnabled } from "../../services/teams-mode";
import type { User } from "../../services/users";
import type { TeamState } from "../../templates/team";
import { Team } from "../../templates/team";
import { csrfTokens } from "../../utils/csrf-tokens";
import { render404 } from "../../utils/errors";
import { type ActionGuard, formAction } from "../../utils/form-action";
import { readFormValues } from "../../utils/form-data";
import { redirect, render } from "../../utils/response";
import { fitFlashState, stateHelpers } from "../../utils/state";

const { getFlash } = stateHelpers<TeamState>();

// Creating a team needs a signed-in user but no membership yet — the one team
// action requireOrgRole can't guard, because there is no org to have a role in.
const signedInUser: ActionGuard<User> = async (req: BunRequest) => {
  if (!teamsEnabled()) return { ok: false, response: render404() };
  const ctx = await getSessionContext(req);
  if (!ctx.isAuthenticated || !ctx.user) {
    return { ok: false, response: redirect("/login") };
  }
  return { ok: true, value: ctx.user, ctx };
};

export const team = {
  async index(req: BunRequest): Promise<Response> {
    if (!teamsEnabled()) return render404();

    const authRedirect = await requireAuth(req);
    if (authRedirect) return authRedirect;

    const ctx = await getSessionContext(req);
    if (!ctx.user || !ctx.sessionId) return redirect("/login");

    if (ctx.requiresSetCookie) {
      setSessionCookie(req, ctx.sessionId);
    }

    const tokens = csrfTokens(ctx);
    const navCsrfToken = await tokens.nav();

    const membership = await getMembership(ctx.user.id);

    // No team yet: the empty state offers to create one. Deliberately not
    // created here — a GET that writes is wrong on its own terms, and it would
    // race invite acceptance, silently landing an invitee in a team of one
    // instead of the team that invited them.
    if (!membership) {
      return render(
        <Team
          user={ctx.user}
          csrfToken={navCsrfToken}
          membership={null}
          members={[]}
          invites={[]}
          createCsrfToken={await tokens.for("/team")}
          inviteCsrfToken={null}
          roleCsrfTokens={{}}
          removeCsrfToken={null}
          removeTarget={null}
          revokeCsrfTokens={{}}
          state={getFlash(req)}
        />,
      );
    }

    // A plain member has no business on the management page; requireOrgRole
    // would bounce them, so don't render it for them either.
    const guard = await requireOrgRole(req, "admin");
    if (!guard.authorized) return guard.response;

    const orgId = membership.org.id;
    const [members, invites] = await Promise.all([
      listMembers(orgId),
      listInvites(orgId),
    ]);

    // Removal is a two-step confirm, so only the member named in ?remove=
    // needs a token — one, not one per row.
    const requestedRemoval = new URL(req.url).searchParams.get("remove");
    const removeTarget =
      members.find((member) => member.id === requestedRemoval) ?? null;

    return render(
      <Team
        user={ctx.user}
        csrfToken={navCsrfToken}
        membership={membership}
        members={members}
        invites={invites}
        createCsrfToken={null}
        inviteCsrfToken={await tokens.for("/team/invites")}
        roleCsrfTokens={
          await tokens.forEach(
            members,
            (member) => `/team/members/${member.id}/role`,
          )
        }
        removeCsrfToken={
          removeTarget
            ? await tokens.for(`/team/members/${removeTarget.id}/remove`)
            : null
        }
        removeTarget={removeTarget}
        revokeCsrfTokens={
          await tokens.forEach(
            invites,
            (invite) => `/team/invites/${invite.id}/revoke`,
          )
        }
        state={getFlash(req)}
      />,
    );
  },

  create: formAction<TeamState, User>({
    redirectTo: "/team",
    guard: signedInUser,
    // Stale but authentic: hand the name back with a fresh token rather than
    // making the user retype it.
    onExpired: async (req) => {
      const { name } = await readFormValues(req, ["name"]);
      return fitFlashState<TeamState>({ state: "csrf-expired", name }, [
        "name",
      ]);
    },
  })(async (req, _ctx, user) => {
    const { name } = await readFormValues(req, ["name"]);

    if (!name || validateOrgName(name)) {
      return { reject: 400, flash: { state: "invalid-name", name } };
    }

    const result = await createOrganizationForUser(user.id, name);

    if (!result.success) {
      return { reject: 409, flash: { state: result.error } };
    }

    return { flash: { state: "team-created" } };
  }),
};
