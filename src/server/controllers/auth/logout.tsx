import { csrfProtection } from "../../middleware/csrf";
import {
  clearSessionCookie,
  deleteSession,
  getSession,
  getSessionIdFromCookies,
} from "../../services/auth";

export const logout = {
  async create(req: Request): Promise<Response> {
    const cookieHeader = req.headers.get("cookie");
    const sessionId = getSessionIdFromCookies(cookieHeader);

    // Check if session actually exists and is valid
    let hasValidSession = false;
    if (sessionId) {
      const sessionData = await getSession(sessionId);
      hasValidSession = sessionData !== null;
    }

    // Only require CSRF protection if user has a valid session
    if (hasValidSession) {
      // CSRF protection for authenticated users
      const csrfResponse = await csrfProtection(req, {
        method: "POST",
        path: "/auth/logout",
      });
      if (csrfResponse) {
        return csrfResponse;
      }

      if (sessionId) {
        try {
          await deleteSession(sessionId);
        } catch {
          // Session deletion failed, but still clear cookie for security
        }
      }
    }

    const clearCookie = clearSessionCookie();

    return new Response("", {
      status: 303,
      headers: {
        Location: "/login",
        "Set-Cookie": clearCookie,
      },
    });
  },
};
