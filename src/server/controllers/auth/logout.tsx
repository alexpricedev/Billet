import type { BunRequest } from "bun";
import { getSessionContext } from "../../middleware/auth";
import { checkCsrf } from "../../middleware/csrf";
import { clearSessionCookie, deleteSession } from "../../services/sessions";

export const logout = {
  async create(req: BunRequest): Promise<Response> {
    const ctx = await getSessionContext(req);

    if (ctx.isAuthenticated && ctx.sessionId) {
      const csrf = await checkCsrf(req, {
        method: "POST",
        path: "/auth/logout",
      });

      // Sign-out is the one action that honours a stale token rather than
      // bouncing. The nav button's token is minted on every page render, so an
      // old tab hits this constantly, and unlike the create/delete flows there
      // is nothing to preserve and no form to return the user to. The request
      // still passed the origin check and still proved possession of the
      // session's CSRF secret; sign-out is idempotent and reversible, and a
      // sign-out button that appears broken is its own security problem.
      if (!csrf.ok && csrf.reason !== "expired-token") {
        return csrf.response;
      }

      try {
        await deleteSession(ctx.sessionId);
      } catch {
        // Session deletion failed, but still clear cookie for security
      }
    }

    clearSessionCookie(req);

    // Clear-Site-Data tells the browser to wipe cookies and client storage for
    // this origin on sign-out — defence in depth beyond deleting the session
    // cookie, in case a page cached auth state in localStorage/sessionStorage.
    return new Response("", {
      status: 303,
      headers: {
        Location: "/login",
        "Clear-Site-Data": '"cookies", "storage"',
      },
    });
  },
};
