import {
  clearSessionCookie,
  deleteSession,
  getSessionIdFromCookies,
} from "../../services/auth";

export const logout = {
  async create(req: Request): Promise<Response> {
    const cookieHeader = req.headers.get("cookie");
    const sessionId = getSessionIdFromCookies(cookieHeader);

    if (sessionId) {
      try {
        await deleteSession(sessionId);
      } catch {
        // Session deletion failed, but still clear cookie for security
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
