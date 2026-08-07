import { randomUUID } from "node:crypto";
import { hashPassword, verifyPassword } from "../utils/crypto";
import {
  consumeUserToken,
  createUserToken,
  findUserByEmail,
  toUser,
  type User,
} from "./auth";
import { db } from "./database";
import { deleteUserSessions } from "./sessions";

// NIST SP 800-63B: length is the only requirement worth enforcing. Composition
// rules ("one number, one symbol") push users toward predictable mutations of a
// short password, so there are none here. The cap exists only so a huge body
// can't be handed to argon2.
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

// Whitespace is a legitimate part of a passphrase, so passwords are never
// trimmed. Only a completely empty value is treated as absent.
export const validatePassword = (password: string): string | null => {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }

  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Password must be ${MAX_PASSWORD_LENGTH} characters or fewer`;
  }

  return null;
};

// A real argon2id hash to verify against when there is no account or the account
// has no password. Without it, "unknown email" would return in microseconds
// while "wrong password" took ~100ms, and the difference is a free account
// enumeration oracle. Built once, lazily, so importing this module doesn't cost
// a hash at boot.
let dummyHash: Promise<string> | null = null;
const getDummyHash = (): Promise<string> => {
  dummyHash ??= hashPassword(randomUUID());
  return dummyHash;
};

export type SignUpResult =
  | { success: true; user: User; verifyToken: string }
  | { success: false; error: "email-taken" | "invalid-password" };

/**
 * Register a new password account and mint its verification token.
 *
 * Unlike sign-in, this cannot hide whether the address is already registered:
 * the caller signs the user straight in, so "pretend it worked" would mean
 * either logging someone into an account they may not own or lying about the
 * outcome. The sign-in and reset paths stay non-enumerable; this one trades
 * that for a usable sign-up, which is the conventional bargain.
 */
export const signUpWithPassword = async (
  email: string,
  password: string,
): Promise<SignUpResult> => {
  if (validatePassword(password)) {
    return { success: false, error: "invalid-password" };
  }

  const normalizedEmail = email.toLowerCase().trim();

  if (await findUserByEmail(normalizedEmail)) {
    return { success: false, error: "email-taken" };
  }

  const passwordHash = await hashPassword(password);

  // ON CONFLICT covers the race between the check above and this insert: two
  // simultaneous sign-ups for the same address both pass the lookup, and the
  // loser gets zero rows back rather than a 500.
  const inserted = await db`
    INSERT INTO users (id, email, password_hash)
    VALUES (${randomUUID()}, ${normalizedEmail}, ${passwordHash})
    ON CONFLICT (email) DO NOTHING
    RETURNING id, email, role, created_at, email_verified_at
  `;

  if (inserted.length === 0) {
    return { success: false, error: "email-taken" };
  }

  const user = toUser(inserted[0]);
  const verifyToken = await createUserToken(user.id, "email_verification");

  return { success: true, user, verifyToken };
};

export type SignInResult =
  | { success: true; user: User }
  | { success: false; reason: "invalid-credentials" | "no-password" };

/**
 * Check an email/password pair.
 *
 * "No such account" and "wrong password" are one answer — `invalid-credentials`
 * — and must render as one message, or the form becomes a way to test which
 * addresses are registered.
 *
 * `no-password` is the deliberate exception. An account carried over from
 * magic-link mode has no password to be wrong, so the generic answer strands
 * the user: every attempt fails and nothing says why. Separating it does make
 * /login report whether an address is a registered carried-over account — see
 * the enumeration posture in SECURITY.md for why that trade was taken and what
 * it costs.
 */
export const signInWithPassword = async (
  email: string,
  password: string,
): Promise<SignInResult> => {
  const normalizedEmail = email.toLowerCase().trim();

  const results = await db`
    SELECT id, email, role, created_at, email_verified_at, password_hash
    FROM users
    WHERE email = ${normalizedEmail}
  `;

  const row = results[0] as
    | (Parameters<typeof toUser>[0] & { password_hash: string | null })
    | undefined;

  // Burn the same work on a miss so the timing is indistinguishable from a
  // wrong password. The no-password branch does it too: its reply already
  // differs, and a faster one there would leak the same thing a second way,
  // through a channel the rate limit can't see.
  if (!row) {
    await verifyPassword(password, await getDummyHash());
    return { success: false, reason: "invalid-credentials" };
  }

  if (!row.password_hash) {
    await verifyPassword(password, await getDummyHash());
    return { success: false, reason: "no-password" };
  }

  return (await verifyPassword(password, row.password_hash))
    ? { success: true, user: toUser(row) }
    : { success: false, reason: "invalid-credentials" };
};

/**
 * Whether an account has a password at all.
 *
 * Switching an existing app to password mode leaves every user without one, so
 * /account has to know which of the two forms to offer.
 */
export const userHasPassword = async (userId: string): Promise<boolean> => {
  const results = await db`
    SELECT password_hash FROM users WHERE id = ${userId}
  `;

  return Boolean(results[0]?.password_hash);
};

export type SetPasswordResult =
  | { success: true }
  | { success: false; error: "already-set" | "invalid-password" };

/**
 * Set a first password for an account that has none.
 *
 * `AND password_hash IS NULL` in the UPDATE is the entire guard, and it is
 * load-bearing: without it this would be a way to replace a password without
 * proving the current one. Doing it in the WHERE rather than a prior SELECT
 * closes the race between the two.
 *
 * Other sessions are dropped for the same reason a change does — the account
 * gains a credential, and anything else holding a session predates it.
 */
export const setInitialPassword = async (
  userId: string,
  newPassword: string,
  keepSessionHash?: string,
): Promise<SetPasswordResult> => {
  if (validatePassword(newPassword)) {
    return { success: false, error: "invalid-password" };
  }

  const updated = await db`
    UPDATE users
    SET password_hash = ${await hashPassword(newPassword)}
    WHERE id = ${userId}
      AND password_hash IS NULL
    RETURNING id
  `;

  if (updated.length === 0) {
    return { success: false, error: "already-set" };
  }

  await deleteUserSessions(userId, keepSessionHash);

  return { success: true };
};

export type ChangePasswordResult =
  | { success: true }
  | { success: false; error: "wrong-password" | "invalid-password" };

/**
 * Change a signed-in user's password, then log out everywhere else.
 *
 * Requiring the current password means someone who walked up to an unlocked
 * screen can't lock the owner out. Dropping the other sessions means an
 * attacker who already stole one is evicted by the change.
 */
export const changePassword = async (
  userId: string,
  currentPassword: string,
  newPassword: string,
  keepSessionHash?: string,
): Promise<ChangePasswordResult> => {
  if (validatePassword(newPassword)) {
    return { success: false, error: "invalid-password" };
  }

  const results = await db`
    SELECT password_hash FROM users WHERE id = ${userId}
  `;

  const currentHash = results[0]?.password_hash as string | null | undefined;

  if (!currentHash || !(await verifyPassword(currentPassword, currentHash))) {
    return { success: false, error: "wrong-password" };
  }

  await db`
    UPDATE users
    SET password_hash = ${await hashPassword(newPassword)}
    WHERE id = ${userId}
  `;

  await deleteUserSessions(userId, keepSessionHash);

  return { success: true };
};

/**
 * Mint a password reset token, or return null if the address isn't registered.
 *
 * The caller flashes the same message either way — the null is for deciding
 * whether to send mail, not for telling the visitor anything.
 */
export const createPasswordReset = async (
  email: string,
): Promise<{ user: User; rawToken: string } | null> => {
  const user = await findUserByEmail(email);

  if (!user) return null;

  return { user, rawToken: await createUserToken(user.id, "password_reset") };
};

export type ResetPasswordResult =
  | { success: true; user: User }
  | { success: false; error: "invalid-token" | "invalid-password" };

/**
 * Spend a reset token and set a new password.
 *
 * Every existing session is destroyed with no exception: a reset is the flow
 * you use when you think someone else has your account, so nothing that existed
 * beforehand can be trusted. The caller issues a fresh session afterwards.
 *
 * The address is also marked verified — the token only reached a mailbox the
 * user could open.
 */
export const resetPassword = async (
  rawToken: string,
  newPassword: string,
): Promise<ResetPasswordResult> => {
  if (validatePassword(newPassword)) {
    return { success: false, error: "invalid-password" };
  }

  const userId = await consumeUserToken(rawToken, "password_reset");

  if (!userId) {
    return { success: false, error: "invalid-token" };
  }

  const updated = await db`
    UPDATE users
    SET password_hash = ${await hashPassword(newPassword)},
        email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP)
    WHERE id = ${userId}
    RETURNING id, email, role, created_at, email_verified_at
  `;

  if (updated.length === 0) {
    return { success: false, error: "invalid-token" };
  }

  await deleteUserSessions(userId);

  return { success: true, user: toUser(updated[0]) };
};

/**
 * Mark an address verified by spending an email_verification token.
 */
export const verifyEmailToken = async (
  rawToken: string,
): Promise<User | null> => {
  const userId = await consumeUserToken(rawToken, "email_verification");

  if (!userId) return null;

  const updated = await db`
    UPDATE users
    SET email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP)
    WHERE id = ${userId}
    RETURNING id, email, role, created_at, email_verified_at
  `;

  return updated.length > 0 ? toUser(updated[0]) : null;
};
