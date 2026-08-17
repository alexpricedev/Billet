import type { BunRequest } from "bun";
import { getSessionContext, requireAuth } from "../../middleware/auth";
import { checkCsrf, isRecoverableCsrfFailure } from "../../middleware/csrf";
import { requireOrgRole } from "../../middleware/org";
import { createCsrfToken } from "../../services/csrf";
import { listInvites } from "../../services/invites";
import {
  createOrganizationForUser,
  getMembership,
  listMembers,
  validateOrgName,
} from "../../services/organizations";
import { setSessionCookie } from "../../services/sessions";
import { teamsEnabled } from "../../services/teams-mode";
import type { TeamState } from "../../templates/team";
import { Team } from "../../templates/team";
import { render404 } from "../../utils/errors";
import { readFormValues } from "../../utils/form-data";
import { redirect, render } from "../../utils/response";
import { fitFlashState, stateHelpers } from "../../utils/state";

const { getFlash, setFlash } = stateHelpers<TeamState>();

export const team = {
  async index(req: BunRequest): Promise<Response> {
    if (!teamsEnabled()) return render404();

    const authRedirect = await requireAuth(req);
    if (authRedirect) return authRedirect;

    const ctx = await getSessionContext(req);
    if (!ctx.user || !ctx.sessionId) return redirect("/login");

    const sessionId = ctx.sessionId;

    if (ctx.requiresSetCookie) {
      setSessionCookie(req, sessionId);
    }

    const navCsrfToken = await createCsrfToken(
      sessionId,
      "POST",
      "/auth/logout",
    );

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
          createCsrfToken={await createCsrfToken(sessionId, "POST", "/team")}
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

    // Tokens are bound to a method and a path, so every form on the page needs
    // its own — one can't be reused across the rows. Same as projects.index.
    const roleCsrfTokens: Record<string, string> = {};
    for (const member of members) {
      roleCsrfTokens[member.id] = await createCsrfToken(
        sessionId,
        "POST",
        `/team/members/${member.id}/role`,
      );
    }

    const revokeCsrfTokens: Record<string, string> = {};
    for (const invite of invites) {
      revokeCsrfTokens[invite.id] = await createCsrfToken(
        sessionId,
        "POST",
        `/team/invites/${invite.id}/revoke`,
      );
    }

    // Removal is a two-step confirm, so only the member named in ?remove=
    // needs a token — one, not one per row.
    const requestedRemoval = new URL(req.url).searchParams.get("remove");
    const removeTarget =
      members.find((member) => member.id === requestedRemoval) ?? null;

    const removeCsrfToken = removeTarget
      ? await createCsrfToken(
          sessionId,
          "POST",
          `/team/members/${removeTarget.id}/remove`,
        )
      : null;

    return render(
      <Team
        user={ctx.user}
        csrfToken={navCsrfToken}
        membership={membership}
        members={members}
        invites={invites}
        createCsrfToken={null}
        inviteCsrfToken={
          await createCsrfToken(sessionId, "POST", "/team/invites")
        }
        roleCsrfTokens={roleCsrfTokens}
        removeCsrfToken={removeCsrfToken}
        removeTarget={removeTarget}
        revokeCsrfTokens={revokeCsrfTokens}
        state={getFlash(req)}
      />,
    );
  },

  async create(req: BunRequest): Promise<Response> {
    if (!teamsEnabled()) return render404();

    const authRedirect = await requireAuth(req);
    if (authRedirect) return authRedirect;

    const ctx = await getSessionContext(req);
    if (!ctx.user || !ctx.sessionId) return redirect("/login");

    const csrf = await checkCsrf(req, { method: "POST", path: "/team" });
    if (!csrf.ok) {
      if (!isRecoverableCsrfFailure(csrf)) return csrf.response;

      // Stale but authentic: hand the name back with a fresh token rather than
      // making the user retype it.
      const stale = await readFormValues(req, ["name"]);
      setFlash(
        req,
        fitFlashState<TeamState>({ state: "csrf-expired", name: stale.name }, [
          "name",
        ]),
      );
      return redirect("/team");
    }

    const { name } = await readFormValues(req, ["name"]);

    if (!name || validateOrgName(name)) {
      setFlash(req, { state: "invalid-name", name });
      return redirect("/team");
    }

    const result = await createOrganizationForUser(ctx.user.id, name);

    if (!result.success) {
      setFlash(req, { state: result.error });
      return redirect("/team");
    }

    setFlash(req, { state: "team-created" });
    return redirect("/team");
  },
};
