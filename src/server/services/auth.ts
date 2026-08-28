import { randomUUID } from "node:crypto";
import { computeHMAC, generateSecureToken } from "../utils/crypto";
import { db } from "./database";
import { createAuthenticatedSession, deleteSession } from "./sessions";

export interface User {
  id: string;
  email: string;
  role: "user" | "admin";
  created_at: Date;
  // Null until the address is proven: set when a magic link is clicked, or when
  // a password user follows their verification email. Nothing is gated on it —
  // it drives the reminder banner and is there for forks that want to gate.
  email_verified_at: Date | null;
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

// The `type` discriminator on user_tokens. Every single-use emailed token in the
// app goes through the same table, hashing, and consume path — only the lifetime
// differs, so a new flow adds a row here rather than a new mechanism.
export type UserTokenType =
  | "magic_link"
  | "password_reset"
  | "email_verification";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

const TOKEN_TTL_MS: Record<UserTokenType, number> = {
  // Short: the link both authenticates and signs in, so a leaked mailbox is a
  // live session.
  magic_link: 15 * MINUTE_MS,
  // Short-ish: also grants account takeover, but users often reset from a
  // different device and need time to get to their inbox.
  password_reset: 60 * MINUTE_MS,
  // Long: proves address ownership only. The user already has a session, so an
  // expired link is pure friction with no security upside.
  email_verification: 24 * HOUR_MS,
};

// What the emails carrying these tokens tell the recipient. Derived from the
// lifetimes above rather than restated, so the copy can't quietly promise an
// expiry the token doesn't have.
export const MAGIC_LINK_EXPIRY_MINUTES = TOKEN_TTL_MS.magic_link / MINUTE_MS;
export const PASSWORD_RESET_EXPIRY_MINUTES =
  TOKEN_TTL_MS.password_reset / MINUTE_MS;
export const EMAIL_VERIFICATION_EXPIRY_HOURS =
  TOKEN_TTL_MS.email_verification / HOUR_MS;

export type AuthResult =
  | { success: true; user: User; sessionId: string }
  | { success: false; error: string };

// Every query that selects a user goes through this, so a row from the driver
// can never reach a template with a timestamp still typed as a string.
export const toUser = (row: {
  id: string;
  email: string;
  role: "user" | "admin";
  created_at: string | Date;
  email_verified_at: string | Date | null;
}): User => ({
  id: row.id,
  email: row.email,
  role: row.role,
  created_at: new Date(row.created_at),
  email_verified_at: row.email_verified_at
    ? new Date(row.email_verified_at)
    : null,
});

/**
 * Look up a user by email without creating one.
 *
 * Password sign-in needs this rather than findOrCreateUser: creating an account
 * because someone mistyped their address would leave a passwordless row behind
 * and turn a typo into a permanent orphan.
 */
export const findUserByEmail = async (email: string): Promise<User | null> => {
  const normalizedEmail = email.toLowerCase().trim();

  const results = await db`
    SELECT id, email, role, created_at, email_verified_at
    FROM users
    WHERE email = ${normalizedEmail}
  `;

  return results.length > 0 ? toUser(results[0]) : null;
};

/**
 * Create or get existing user by email
 * Normalizes email to lowercase for consistent lookups
 */
export const findOrCreateUser = async (email: string): Promise<User> => {
  const normalizedEmail = email.toLowerCase().trim();

  // First try to find existing user
  const existing = await findUserByEmail(normalizedEmail);

  if (existing) {
    return existing;
  }

  // Create new user if not found
  const userId = randomUUID();
  const newUser = await db`
    INSERT INTO users (id, email)
    VALUES (${userId}, ${normalizedEmail})
    RETURNING id, email, role, created_at, email_verified_at
  `;

  return toUser(newUser[0]);
};

/**
 * Mint a single-use token for a user and return the raw value.
 *
 * Only the HMAC of the token is stored, so a database dump can't be replayed as
 * a login — the raw value exists only in the email that carries it.
 */
export const createUserToken = async (
  userId: string,
  type: UserTokenType,
): Promise<string> => {
  const rawToken = generateSecureToken(32);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS[type]);

  await db`
    INSERT INTO user_tokens (id, user_id, token_hash, type, expires_at)
    VALUES (
      ${randomUUID()},
      ${userId},
      ${computeHMAC(rawToken)},
      ${type},
      ${expiresAt.toISOString()}
    )
  `;

  return rawToken;
};

/**
 * Consume a token of a given type, returning the user it belongs to.
 *
 * The single UPDATE ... RETURNING is what makes this race-safe: two concurrent
 * requests with the same token both try to claim the row, and only the one that
 * flips used_at from NULL gets a row back. Type is part of the WHERE clause, so
 * a verification token can never be spent as a password reset.
 */
export const consumeUserToken = async (
  rawToken: string,
  type: UserTokenType,
): Promise<string | null> => {
  const results = await db`
    UPDATE user_tokens
    SET used_at = CURRENT_TIMESTAMP
    WHERE type = ${type}
      AND token_hash = ${computeHMAC(rawToken)}
      AND used_at IS NULL
      AND expires_at > CURRENT_TIMESTAMP
    RETURNING user_id
  `;

  return results.length > 0 ? (results[0].user_id as string) : null;
};

/**
 * Issue a fresh authenticated session, discarding whatever the request arrived
 * with.
 *
 * Every sign-in path calls this instead of createAuthenticatedSession directly:
 * reusing the id an anonymous visitor arrived with would let an attacker who
 * planted that cookie ride the session once it gains privileges.
 *
 * `previousSessionId` is the raw cookie value, not a session the caller has
 * already looked up — resolving it first would mean creating a guest session
 * for a cookieless visitor purely to delete it a line later. The type isn't
 * checked either: a guest session must go, and an authenticated one belongs to
 * a sign-in that is being replaced, so it would only linger as an orphan.
 * Deleting an id that no longer exists is a no-op.
 */
export const regenerateSession = async (
  userId: string,
  previousSessionId?: string | null,
): Promise<string> => {
  if (previousSessionId) {
    await deleteSession(previousSessionId);
  }

  return createAuthenticatedSession(userId);
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
  const rawToken = await createUserToken(user.id, "magic_link");

  return { user, rawToken };
};

/**
 * Verify a magic link token and consume it
 * Uses atomic UPDATE to prevent race conditions - only unused, valid tokens are consumed
 * Returns user data and creates new session on success
 */
export const verifyMagicLink = async (
  rawToken: string,
  previousSessionId?: string | null,
): Promise<AuthResult> => {
  const userId = await consumeUserToken(rawToken, "magic_link");

  // No row claimed means the token was invalid, expired, or already used
  if (!userId) {
    return { success: false, error: "Invalid or expired token" };
  }

  // Clicking a link sent to the address proves the user owns it, so the magic
  // link doubles as email verification. COALESCE keeps the original timestamp
  // on every subsequent sign-in.
  const userResults = await db`
    UPDATE users
    SET email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP)
    WHERE id = ${userId}
    RETURNING id, email, role, created_at, email_verified_at
  `;

  if (userResults.length === 0) {
    return { success: false, error: "User not found" };
  }

  const sessionId = await regenerateSession(userId, previousSessionId);

  return { success: true, user: toUser(userResults[0]), sessionId };
};

/**
 * Delete expired rows from the two auth tables.
 *
 * Not a correctness measure — every read in this file, `sessions.ts` and
 * `csrf.ts` already filters `expires_at > CURRENT_TIMESTAMP`, so an expired row
 * is inert whether or not it is still here. What it buys is bloat (guest
 * sessions churn faster than anything else in the schema) and retention: a
 * spent `user_tokens` row keeps a live-looking `token_hash` indefinitely.
 *
 * Scoped to auth's own tables on purpose. `organization_invites` expires too,
 * but auth must not import the team surface — `cleanup.ts` composes the two.
 *
 * Called on a timer by `startCleanupSweep`; safe to run concurrently with
 * anything, and safe to run twice.
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
