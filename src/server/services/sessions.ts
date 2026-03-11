import { randomUUID } from "node:crypto";
import type { BunRequest } from "bun";
import { computeHMAC } from "../utils/crypto";
import {
  type DatabaseMutationResult,
  hasAffectedRows,
} from "../utils/database";
import type { User } from "./auth";
import { db } from "./database";

export type SessionType = "guest" | "authenticated";

export interface SessionContext {
  sessionId: string | null;
  sessionHash: string | null;
  sessionType: SessionType | null;
  user: User | null;
  isGuest: boolean;
  isAuthenticated: boolean;
  requiresSetCookie: boolean;
}

const GUEST_EXPIRY_MS = 24 * 60 * 60 * 1000;
const AUTH_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

export const SESSION_COOKIE_NAME = "session_id";
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 30 * 24 * 60 * 60,
};

export const getSessionIdFromRequest = (req: BunRequest): string | null => {
  return req.cookies.get(SESSION_COOKIE_NAME) || null;
};

export const setSessionCookie = (
  req: BunRequest,
  rawSessionId: string,
): void => {
  req.cookies.set(SESSION_COOKIE_NAME, rawSessionId, SESSION_COOKIE_OPTIONS);
};

export const clearSessionCookie = (req: BunRequest): void => {
  req.cookies.delete(SESSION_COOKIE_NAME);
};

export const createGuestSession = async (): Promise<string> => {
  const rawSessionId = randomUUID();
  const sessionIdHash = computeHMAC(rawSessionId);
  const expiresAt = new Date(Date.now() + GUEST_EXPIRY_MS);

  await db`
    INSERT INTO sessions (id_hash, session_type, expires_at)
    VALUES (${sessionIdHash}, 'guest', ${expiresAt.toISOString()})
  `;

  return rawSessionId;
};

export const createAuthenticatedSession = async (
  userId: string,
): Promise<string> => {
  const rawSessionId = randomUUID();
  const sessionIdHash = computeHMAC(rawSessionId);
  const expiresAt = new Date(Date.now() + AUTH_EXPIRY_MS);

  await db`
    INSERT INTO sessions (id_hash, user_id, session_type, expires_at)
    VALUES (${sessionIdHash}, ${userId}, 'authenticated', ${expiresAt.toISOString()})
  `;

  return rawSessionId;
};

export const getSessionContextFromDB = async (
  rawSessionId: string,
): Promise<SessionContext | null> => {
  try {
    const sessionIdHash = computeHMAC(rawSessionId);

    const result = await db`
      SELECT
        s.id_hash, s.user_id, s.session_type,
        s.expires_at, s.last_activity_at, s.created_at,
        u.id as user_id_result, u.email, u.role, u.created_at as user_created_at
      FROM sessions s
      LEFT JOIN users u ON s.user_id = u.id
      WHERE s.id_hash = ${sessionIdHash}
        AND s.expires_at > CURRENT_TIMESTAMP
    `;

    if (result.length === 0) return null;

    const data = result[0] as {
      id_hash: string;
      user_id: string | null;
      session_type: string;
      expires_at: string;
      last_activity_at: string;
      created_at: string;
      user_id_result: string | null;
      email: string | null;
      role: "user" | "admin" | null;
      user_created_at: string | null;
    };

    const isAuthenticated =
      data.session_type === "authenticated" && data.user_id_result !== null;
    const user: User | null = isAuthenticated
      ? {
          id: data.user_id_result as string,
          email: data.email as string,
          role: (data.role as "user" | "admin") ?? "user",
          created_at: new Date(data.user_created_at as string),
        }
      : null;

    return {
      sessionId: rawSessionId,
      sessionHash: data.id_hash,
      sessionType: data.session_type as SessionType,
      user,
      isGuest: data.session_type === "guest",
      isAuthenticated,
      requiresSetCookie: false,
    };
  } catch {
    return null;
  }
};

export const convertGuestToAuthenticated = async (
  sessionHash: string,
  userId: string,
): Promise<boolean> => {
  try {
    const expiresAt = new Date(Date.now() + AUTH_EXPIRY_MS);

    const result = await db`
      UPDATE sessions
      SET user_id = ${userId},
          session_type = 'authenticated',
          expires_at = ${expiresAt.toISOString()}
      WHERE id_hash = ${sessionHash}
        AND session_type = 'guest'
        AND expires_at > CURRENT_TIMESTAMP
    `;

    return hasAffectedRows(result as DatabaseMutationResult);
  } catch {
    return false;
  }
};

export const deleteSession = async (rawSessionId: string): Promise<boolean> => {
  try {
    const sessionIdHash = computeHMAC(rawSessionId);

    const result = await db`
      DELETE FROM sessions
      WHERE id_hash = ${sessionIdHash}
    `;

    return hasAffectedRows(result as DatabaseMutationResult);
  } catch {
    return false;
  }
};

export const renewSession = async (rawSessionId: string): Promise<boolean> => {
  try {
    const sessionIdHash = computeHMAC(rawSessionId);

    const result = await db`
      UPDATE sessions
      SET last_activity_at = CURRENT_TIMESTAMP
      WHERE id_hash = ${sessionIdHash}
        AND expires_at > CURRENT_TIMESTAMP
    `;

    return hasAffectedRows(result as DatabaseMutationResult);
  } catch {
    return false;
  }
};
