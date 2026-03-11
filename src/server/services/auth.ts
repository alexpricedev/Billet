import { randomUUID } from "node:crypto";
import { computeHMAC, generateSecureToken } from "../utils/crypto";
import { db } from "./database";
import { createAuthenticatedSession, deleteSession } from "./sessions";

export interface User {
  id: string;
  email: string;
  role: "user" | "admin";
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
    SELECT id, email, role, created_at
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
    RETURNING id, email, role, created_at
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
  guestSessionId?: string | null,
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
    SELECT id, email, role, created_at
    FROM users
    WHERE id = ${tokenData.user_id}
  `;

  if (userResults.length === 0) {
    return { success: false, error: "User not found" };
  }

  const userData = userResults[0] as {
    id: string;
    email: string;
    role: "user" | "admin";
    created_at: string;
  };

  // Always create a fresh session to prevent session fixation attacks
  if (guestSessionId) {
    await deleteSession(guestSessionId);
  }
  const sessionId = await createAuthenticatedSession(tokenData.user_id);

  const user: User = {
    id: userData.id,
    email: userData.email,
    role: userData.role,
    created_at: new Date(userData.created_at),
  };

  return { success: true, user, sessionId };
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
