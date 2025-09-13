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

    // Renew session activity for authenticated requests
    await renewSession(sessionId);

    return {
      user: sessionData.user,
      isAuthenticated: true,
    };
  } catch (error) {
    console.error("Error getting auth context:", error);
    return { user: null, isAuthenticated: false };
  }
};

/**
 * Middleware to require authentication
 */
export const requireAuth = async (req: Request): Promise<Response | null> => {
  const auth = await getAuthContext(req);

  if (!auth.isAuthenticated) {
    return new Response("", {
      status: 303,
      headers: { Location: "/login" },
    });
  }

  return null; // Continue with request
};

/**
 * Middleware to redirect authenticated users away from auth pages
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

  return null; // Continue with request
};
