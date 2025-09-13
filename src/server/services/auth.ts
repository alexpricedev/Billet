import { randomUUID } from "node:crypto";
import { computeHMAC, generateSecureToken } from "../utils/crypto";
import {
  type DatabaseMutationResult,
  hasAffectedRows,
} from "../utils/database";
import { db } from "./database";

export interface User {
  id: string;
  email: string;
  created_at: Date;
}

export interface Session {
  id_hash: string;
  user_id: string;
  expires_at: Date;
  last_activity_at: Date;
  created_at: Date;
}

export interface UserToken {
  id: string;
  user_id: string;
  token_hash: string;
  type: string;
  expires_at: Date;
  used_at: Date | null;
  created_at: Date;
}

interface SessionQueryResult {
  id_hash: string;
  user_id: string;
  session_expires_at: string;
  session_last_activity_at: string;
  session_created_at: string;
  user_id_result: string;
  email: string;
  user_created_at: string;
}

export type AuthResult =
  | { success: true; user: User; sessionId: string }
  | { success: false; error: string };

/**
 * Create or get existing user by email
 * Normalizes email to lowercase for consistent lookups
 */
export const findOrCreateUser = async (email: string): Promise<User> => {
  const normalizedEmail = email.toLowerCase().trim();

  // First try to find existing user
  const existing = await db`
    SELECT id, email, created_at 
    FROM users 
    WHERE email = ${normalizedEmail}
  `;

  if (existing.length > 0) {
    return existing[0] as User;
  }

  // Create new user if not found
  const userId = randomUUID();
  const newUser = await db`
    INSERT INTO users (id, email) 
    VALUES (${userId}, ${normalizedEmail}) 
    RETURNING id, email, created_at
  `;

  return newUser[0] as User;
};

/**
 * Create a magic link token for a user
 * Generates cryptographically secure token, hashes with HMAC-SHA256, stores in database
 * Token expires in 15 minutes for security
 */
export const createMagicLink = async (
  email: string,
): Promise<{ user: User; rawToken: string }> => {
  const user = await findOrCreateUser(email);

  const rawToken = generateSecureToken(32);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  const tokenHashString = computeHMAC(rawToken);
  const tokenId = randomUUID();
  await db`
    INSERT INTO user_tokens (id, user_id, token_hash, type, expires_at)
    VALUES (
      ${tokenId},
      ${user.id}, 
      ${tokenHashString}, 
      'magic_link', 
      ${expiresAt.toISOString()}
    )
  `;

  return { user, rawToken };
};

/**
 * Verify a magic link token and consume it
 * Uses atomic UPDATE to prevent race conditions - only unused, valid tokens are consumed
 * Returns user data and creates new session on success
 */
export const verifyMagicLink = async (
  rawToken: string,
): Promise<AuthResult> => {
  const providedTokenHash = computeHMAC(rawToken);

  // Atomic verification prevents race conditions - only unused, valid tokens are marked as used
  const tokenResults = await db`
    UPDATE user_tokens 
    SET used_at = CURRENT_TIMESTAMP 
    WHERE type = 'magic_link' 
      AND token_hash = ${providedTokenHash}
      AND used_at IS NULL 
      AND expires_at > CURRENT_TIMESTAMP
    RETURNING id, user_id, token_hash, expires_at, used_at
  `;

  // No rows updated means token was invalid, expired, or already used
  if (tokenResults.length === 0) {
    return { success: false, error: "Invalid or expired token" };
  }

  const tokenData = tokenResults[0] as {
    id: string;
    user_id: string;
    token_hash: string;
    expires_at: string;
    used_at: string | null;
  };

  const userResults = await db`
    SELECT id, email, created_at 
    FROM users 
    WHERE id = ${tokenData.user_id}
  `;

  if (userResults.length === 0) {
    return { success: false, error: "User not found" };
  }

  const userData = userResults[0] as {
    id: string;
    email: string;
    created_at: string;
  };

  const sessionId = await createSession(tokenData.user_id);

  const user: User = {
    id: userData.id,
    email: userData.email,
    created_at: new Date(userData.created_at),
  };

  return { success: true, user, sessionId };
};

/**
 * Create a new session for a user
 * Returns raw session ID for cookie, stores HMAC-SHA256 hash in database for security
 * Session expires in 30 days
 */
export const createSession = async (userId: string): Promise<string> => {
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const rawSessionId = randomUUID();
  const sessionIdHash = computeHMAC(rawSessionId);

  await db`
    INSERT INTO sessions (id_hash, user_id, expires_at)
    VALUES (${sessionIdHash}, ${userId}, ${expiresAt.toISOString()})
  `;

  return rawSessionId;
};

/**
 * Get session and user data using raw session ID
 * Computes HMAC internally for secure database lookup, returns null for invalid/expired sessions
 */
export const getSession = async (
  rawSessionId: string,
): Promise<{ user: User; session: Session } | null> => {
  try {
    const sessionIdHash = computeHMAC(rawSessionId);

    const result = await db`
      SELECT 
        s.id_hash, s.user_id, s.expires_at as session_expires_at, 
        s.last_activity_at as session_last_activity_at, s.created_at as session_created_at,
        u.id as user_id_result, u.email, u.created_at as user_created_at
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.id_hash = ${sessionIdHash}
        AND s.expires_at > CURRENT_TIMESTAMP
    `;

    if (result.length === 0) {
      return null;
    }

    const data = result[0] as SessionQueryResult;

    return {
      user: {
        id: data.user_id_result,
        email: data.email,
        created_at: new Date(data.user_created_at),
      },
      session: {
        id_hash: data.id_hash,
        user_id: data.user_id,
        expires_at: new Date(data.session_expires_at),
        last_activity_at: new Date(data.session_last_activity_at),
        created_at: new Date(data.session_created_at),
      },
    };
  } catch {
    return null;
  }
};

/**
 * Delete a session (logout) using raw session ID
 * Computes HMAC internally for secure database lookup
 */
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

/**
 * Renew session activity timestamp
 * Updates last_activity_at for valid sessions to track user activity
 */
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

/**
 * Clean up expired tokens and sessions
 * Should be run periodically to prevent database bloat
 */
export const cleanupExpired = async (): Promise<void> => {
  await db`
    DELETE FROM user_tokens 
    WHERE expires_at < CURRENT_TIMESTAMP
  `;

  await db`
    DELETE FROM sessions 
    WHERE expires_at < CURRENT_TIMESTAMP
  `;
};

/**
 * Cookie configuration for sessions
 * HttpOnly prevents XSS, Secure for HTTPS, SameSite=Lax prevents CSRF
 */
export const SESSION_COOKIE_NAME = "session_id";
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "Lax" as const,
  path: "/",
  maxAge: 30 * 24 * 60 * 60, // 30 days in seconds
};

/**
 * Create session cookie header value with security attributes
 */
export const createSessionCookie = (rawSessionId: string): string => {
  const options = SESSION_COOKIE_OPTIONS;
  let cookie = `${SESSION_COOKIE_NAME}=${rawSessionId}`;

  if (options.httpOnly) cookie += "; HttpOnly";
  if (options.secure) cookie += "; Secure";
  if (options.sameSite) cookie += `; SameSite=${options.sameSite}`;
  if (options.path) cookie += `; Path=${options.path}`;
  if (options.maxAge) {
    cookie += `; Max-Age=${options.maxAge}`;
    const expires = new Date(Date.now() + options.maxAge * 1000);
    cookie += `; Expires=${expires.toUTCString()}`;
  }

  return cookie;
};

/**
 * Create cookie header value for clearing session
 * Mirrors security attributes to ensure proper cookie deletion across browsers
 */
export const clearSessionCookie = (): string => {
  const options = SESSION_COOKIE_OPTIONS;
  let cookie = `${SESSION_COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0`;

  if (options.sameSite) cookie += `; SameSite=${options.sameSite}`;
  if (options.secure) cookie += "; Secure";
  const expires = new Date(0);
  cookie += `; Expires=${expires.toUTCString()}`;

  return cookie;
};

/**
 * Extract session ID from request cookies
 * Parses Cookie header to find session_id value
 */
export const getSessionIdFromCookies = (
  cookieHeader: string | null,
): string | null => {
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(";").map((c) => c.trim());
  const sessionCookie = cookies.find((c) =>
    c.startsWith(`${SESSION_COOKIE_NAME}=`),
  );

  if (!sessionCookie) return null;

  return sessionCookie.split("=")[1] || null;
};
