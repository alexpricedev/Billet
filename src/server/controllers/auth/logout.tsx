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

    return new Response("", {
      status: 303,
      headers: { Location: "/login" },
    });
  },
};
