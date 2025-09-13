import { randomUUID } from "node:crypto";
import { computeHMAC, generateSecureToken } from "../utils/crypto";
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

interface DeleteResult {
  count?: number;
  rowCount?: number;
}

export type AuthResult =
  | { success: true; user: User; sessionId: string }
  | { success: false; error: string };

/**
 * Create or get existing user by email
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
 */
export const createMagicLink = async (
  email: string,
): Promise<{ user: User; rawToken: string }> => {
  const user = await findOrCreateUser(email);

  // Generate a cryptographically secure token
  const rawToken = generateSecureToken(32);

  // Set expiry to 15 minutes from now
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  const tokenHashString = computeHMAC(rawToken);

  // Store hashed token in database
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
 */
export const verifyMagicLink = async (
  rawToken: string,
): Promise<AuthResult> => {
  // Hash the provided token to compare with stored hash
  const providedTokenHash = computeHMAC(rawToken);

  // Atomic verification: mark token as used ONLY if it's currently unused and valid
  // This prevents race conditions where multiple requests could use the same token
  const tokenResults = await db`
    UPDATE user_tokens 
    SET used_at = CURRENT_TIMESTAMP 
    WHERE type = 'magic_link' 
      AND token_hash = ${providedTokenHash}
      AND used_at IS NULL 
      AND expires_at > CURRENT_TIMESTAMP
    RETURNING id, user_id, token_hash, expires_at, used_at
  `;

  // If no rows were updated, the token was invalid, expired, or already used
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

  // Get user data for the successful token verification
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

  // Create session
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
 * Returns the raw session ID (for cookie), while storing the HMAC in the database
 */
export const createSession = async (userId: string): Promise<string> => {
  // Set session to expire in 30 days
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
 * Computes HMAC internally for database lookup
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
    // If query fails, return null
    return null;
  }
};

/**
 * Delete a session (logout) using raw session ID
 */
export const deleteSession = async (rawSessionId: string): Promise<boolean> => {
  try {
    const sessionIdHash = computeHMAC(rawSessionId);

    const result = await db`
      DELETE FROM sessions 
      WHERE id_hash = ${sessionIdHash}
    `;

    // Check if any rows were affected
    const deleteResult = result as DeleteResult;
    return Boolean(
      (deleteResult.count && deleteResult.count > 0) ||
        (deleteResult.rowCount && deleteResult.rowCount > 0),
    );
  } catch {
    // If delete fails, return false
    return false;
  }
};

/**
 * Renew session activity timestamp
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

    const updateResult = result as DeleteResult;
    return Boolean(
      (updateResult.count && updateResult.count > 0) ||
        (updateResult.rowCount && updateResult.rowCount > 0),
    );
  } catch {
    return false;
  }
};

/**
 * Clean up expired tokens and sessions
 */
export const cleanupExpired = async (): Promise<void> => {
  // Remove expired tokens
  await db`
    DELETE FROM user_tokens 
    WHERE expires_at < CURRENT_TIMESTAMP
  `;

  // Remove expired sessions
  await db`
    DELETE FROM sessions 
    WHERE expires_at < CURRENT_TIMESTAMP
  `;
};

/**
 * Cookie configuration for sessions
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
 * Create session cookie header value
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
    // Add Expires for legacy browser support
    const expires = new Date(Date.now() + options.maxAge * 1000);
    cookie += `; Expires=${expires.toUTCString()}`;
  }

  return cookie;
};

/**
 * Create cookie header value for clearing session
 * Mirrors all attributes to ensure proper overwriting across browsers
 */
export const clearSessionCookie = (): string => {
  const options = SESSION_COOKIE_OPTIONS;
  let cookie = `${SESSION_COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0`;

  if (options.sameSite) cookie += `; SameSite=${options.sameSite}`;
  if (options.secure) cookie += "; Secure";
  // Add Expires for legacy browser support
  const expires = new Date(0);
  cookie += `; Expires=${expires.toUTCString()}`;

  return cookie;
};

/**
 * Extract session ID from request cookies
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
