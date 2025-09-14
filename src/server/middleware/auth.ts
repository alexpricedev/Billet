import type { User } from "../services/auth";
import {
  getSession,
  getSessionIdFromCookies,
  renewSession,
} from "../services/auth";

export interface AuthContext {
  user: User | null;
  isAuthenticated: boolean;
}

/**
 * Extract authentication context from request
 * Renews session activity for authenticated users
 */
export const getAuthContext = async (req: Request): Promise<AuthContext> => {
  const cookieHeader = req.headers.get("cookie");
  const sessionId = getSessionIdFromCookies(cookieHeader);

  if (!sessionId) {
    return { user: null, isAuthenticated: false };
  }

  try {
    const sessionData = await getSession(sessionId);

    if (!sessionData) {
      return { user: null, isAuthenticated: false };
    }

    await renewSession(sessionId);

    return {
      user: sessionData.user,
      isAuthenticated: true,
    };
  } catch {
    return { user: null, isAuthenticated: false };
  }
};

/**
 * Middleware to require authentication
 * Returns redirect response if not authenticated, null to continue
 */
export const requireAuth = async (req: Request): Promise<Response | null> => {
  const auth = await getAuthContext(req);

  if (!auth.isAuthenticated) {
    return new Response("", {
      status: 303,
      headers: { Location: "/login" },
    });
  }

  return null;
};

/**
 * Middleware to redirect authenticated users away from auth pages
 * Returns redirect response if authenticated, null to continue
 */
export const redirectIfAuthenticated = async (
  req: Request,
): Promise<Response | null> => {
  const auth = await getAuthContext(req);

  if (auth.isAuthenticated) {
    return new Response("", {
      status: 303,
      headers: { Location: "/" },
    });
  }

  return null;
};
