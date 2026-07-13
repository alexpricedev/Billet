import type { BunRequest } from "bun";
import { getSessionContext } from "../../middleware/auth";
import { csrfProtection } from "../../middleware/csrf";
import { clearSessionCookie, deleteSession } from "../../services/sessions";

export const logout = {
  async create(req: BunRequest): Promise<Response> {
    const ctx = await getSessionContext(req);

    if (ctx.isAuthenticated && ctx.sessionId) {
      const csrfResponse = await csrfProtection(req, {
        method: "POST",
        path: "/auth/logout",
      });
      if (csrfResponse) {
        return csrfResponse;
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
