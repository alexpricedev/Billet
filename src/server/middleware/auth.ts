import type { BunRequest } from "bun";
import {
  createGuestSession,
  getSessionContextFromDB,
  getSessionIdFromRequest,
  renewSession,
  type SessionContext,
} from "../services/sessions";

export type { SessionContext };

const EMPTY_CONTEXT: SessionContext = {
  sessionId: null,
  sessionHash: null,
  sessionType: null,
  user: null,
  isGuest: false,
  isAuthenticated: false,
  requiresSetCookie: false,
};

const createGuestContext = async (): Promise<SessionContext> => {
  try {
    const sessionId = await createGuestSession();
    return {
      sessionId,
      sessionHash: null,
      sessionType: "guest",
      user: null,
      isGuest: true,
      isAuthenticated: false,
      requiresSetCookie: true,
    };
  } catch {
    return EMPTY_CONTEXT;
  }
};

export const getSessionContext = async (
  req: BunRequest,
): Promise<SessionContext> => {
  try {
    const sessionId = getSessionIdFromRequest(req);

    if (!sessionId) {
      return createGuestContext();
    }

    const ctx = await getSessionContextFromDB(sessionId);

    if (!ctx) {
      return createGuestContext();
    }

    if (ctx.isAuthenticated) {
      await renewSession(sessionId);
    }

    return ctx;
  } catch {
    return createGuestContext();
  }
};

export const requireAuth = async (
  req: BunRequest,
): Promise<Response | null> => {
  const ctx = await getSessionContext(req);

  if (!ctx.isAuthenticated) {
    return new Response("", {
      status: 303,
      headers: { Location: "/login" },
    });
  }

  return null;
};

export type GuestPage = { redirect: Response } | { ctx: SessionContext };

/**
 * The GET side of a signed-out form page: bounce anyone already signed in,
 * otherwise hand the session context back so the caller can set the guest
 * cookie and mint a CSRF token against it.
 *
 * Returning the context is the point. `getSessionContext` creates a guest
 * session as a side effect, so a caller that only wanted the redirect was
 * writing a session row per request and then dropping the id — which left the
 * auth forms with no session to bind a token to, and no cookie to prove it.
 */
export const guestPageContext = async (req: BunRequest): Promise<GuestPage> => {
  const ctx = await getSessionContext(req);

  if (ctx.isAuthenticated) {
    return {
      redirect: new Response("", {
        status: 303,
        headers: { Location: "/" },
      }),
    };
  }

  return { ctx };
};
