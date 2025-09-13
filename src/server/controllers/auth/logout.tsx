import {
  clearSessionCookie,
  deleteSession,
  getSessionIdFromCookies,
} from "../../services/auth";

export const logout = {
  async create(req: Request): Promise<Response> {
    // TODO: Add CSRF protection when implementing other POST auth endpoints
    // Consider double-submit cookie pattern or CSRF tokens for defense-in-depth
    // SameSite=Lax provides some protection but not complete

    const cookieHeader = req.headers.get("cookie");
    const sessionId = getSessionIdFromCookies(cookieHeader);

    if (sessionId) {
      try {
        await deleteSession(sessionId);
      } catch (error) {
        console.error("Error deleting session:", error);
      }
    }

    // Clear session cookie and redirect to login
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
