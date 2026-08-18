import { randomUUID } from "node:crypto";
import type { SQL } from "bun";
import { computeHMAC, generateSecureToken } from "../utils/crypto";
import {
  type DatabaseMutationResult,
  hasAffectedRows,
} from "../utils/database";
import { toUser, type User } from "./auth";
import { db } from "./database";
import { log } from "./logger";
import { organisationsEnabled } from "./organisations-mode";

export interface Organisation {
  id: string;
  name: string;
  created_at: Date;
}

// "owner" is whoever created the organisation at sign-up; only an owner can
// invite or revoke. Everyone who arrives by invitation is a "member".
export type OrganisationRole = "owner" | "member";

export interface OrganisationMember {
  user_id: string;
  email: string;
  role: OrganisationRole;
  created_at: Date;
}

export interface OrganisationInvite {
  id: string;
  organisation_id: string;
  email: string;
  expires_at: Date;
  created_at: Date;
}

export const MIN_ORGANISATION_NAME_LENGTH = 2;
export const MAX_ORGANISATION_NAME_LENGTH = 100;

// Long: an invite is an administrative act, not a credential — it grants
// membership of one organisation and nothing else, and the person receiving it
// may not be expecting the email at all.
export const ORGANISATION_INVITE_EXPIRY_DAYS = 7;
const INVITE_TTL_MS = ORGANISATION_INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

/**
 * Returns an error message, or null when the name is usable. Mirrors
 * validatePassword in passwords.ts so controllers treat both the same way.
 */
export const validateOrganisationName = (name: string): string | null => {
  if (name.length < MIN_ORGANISATION_NAME_LENGTH) {
    return `Organisation name must be at least ${MIN_ORGANISATION_NAME_LENGTH} characters`;
  }

  if (name.length > MAX_ORGANISATION_NAME_LENGTH) {
    return `Organisation name must be ${MAX_ORGANISATION_NAME_LENGTH} characters or fewer`;
  }

  return null;
};

const toOrganisation = (row: {
  id: string;
  name: string;
  created_at: string | Date;
}): Organisation => ({
  id: row.id,
  name: row.name,
  created_at: new Date(row.created_at),
});

/**
 * How many users have no organisation.
 *
 * Only ever non-zero when the flag is switched on for an app that already has
 * users — sign-up creates the membership in the same transaction as the account,
 * and invite acceptance does the same. assertOrganisationsReady turns a non-zero
 * count into a refusal to boot.
 */
export const countUsersWithoutOrganisation = async (): Promise<number> => {
  const results = await db`
    SELECT count(*)::int AS count
    FROM users u
    WHERE NOT EXISTS (
      SELECT 1 FROM organisation_members m WHERE m.user_id = u.id
    )
  `;

  return results[0].count as number;
};

// The users INSERT is spelled out here rather than reused from auth.ts because
// it has to run on the transaction handle: a user created outside the
// transaction that later fails to get a membership is exactly the orphan the
// boot guard refuses to start on. ON CONFLICT covers two simultaneous sign-ups
// for the same address, matching signUpWithPassword.
const insertUser = async (
  tx: SQL,
  email: string,
  passwordHash: string | null,
): Promise<User | null> => {
  const inserted = await tx`
    INSERT INTO users (id, email, password_hash)
    VALUES (${randomUUID()}, ${email}, ${passwordHash})
    ON CONFLICT (email) DO NOTHING
    RETURNING id, email, role, created_at, email_verified_at
  `;

  return inserted.length > 0 ? toUser(inserted[0]) : null;
};

const insertMembership = async (
  tx: SQL,
  organisationId: string,
  userId: string,
  role: OrganisationRole,
): Promise<void> => {
  await tx`
    INSERT INTO organisation_members (id, organisation_id, user_id, role)
    VALUES (${randomUUID()}, ${organisationId}, ${userId}, ${role})
  `;
};

export type SignUpWithOrganisationResult =
  | { success: true; user: User; organisation: Organisation }
  | { success: false; error: "email-taken" };

/**
 * Create a user, their organisation, and the owner membership joining them — all
 * or nothing.
 *
 * `passwordHash` is null in magic-link mode, where the account has no credential
 * of its own. The caller mints whatever token the mode needs afterwards; a
 * failure there costs an email, not a half-built account.
 */
export const signUpWithOrganisation = async (
  email: string,
  organisationName: string,
  passwordHash: string | null = null,
): Promise<SignUpWithOrganisationResult> => {
  const normalizedEmail = email.toLowerCase().trim();

  const created = await db.begin(async (tx) => {
    const user = await insertUser(tx as SQL, normalizedEmail, passwordHash);
    if (!user) return null;

    const orgRows = await tx`
      INSERT INTO organisations (id, name)
      VALUES (${randomUUID()}, ${organisationName})
      RETURNING id, name, created_at
    `;
    const organisation = toOrganisation(orgRows[0]);

    await insertMembership(tx as SQL, organisation.id, user.id, "owner");

    return { user, organisation };
  });

  return created
    ? { success: true, user: created.user, organisation: created.organisation }
    : { success: false, error: "email-taken" };
};

/**
 * Create a user already joined to an existing organisation. The invite path's
 * equivalent of signUpWithOrganisation, and atomic for the same reason.
 */
export const signUpIntoOrganisation = async (
  email: string,
  organisationId: string,
  passwordHash: string | null = null,
): Promise<
  { success: true; user: User } | { success: false; error: "email-taken" }
> => {
  const normalizedEmail = email.toLowerCase().trim();

  const user = await db.begin(async (tx) => {
    const created = await insertUser(tx as SQL, normalizedEmail, passwordHash);
    if (!created) return null;

    await insertMembership(tx as SQL, organisationId, created.id, "member");

    return created;
  });

  return user
    ? { success: true, user }
    : { success: false, error: "email-taken" };
};

/** Join an existing user to an organisation. False when they already belong to one. */
export const addMember = async (
  organisationId: string,
  userId: string,
  role: OrganisationRole = "member",
): Promise<boolean> => {
  try {
    await insertMembership(db, organisationId, userId, role);
    return true;
  } catch {
    // The UNIQUE (user_id) constraint. One organisation per user is the whole
    // point, so a violation is an expected answer here, not an error.
    return false;
  }
};

export const getOrganisationForUser = async (
  userId: string,
): Promise<{ organisation: Organisation; role: OrganisationRole } | null> => {
  const results = await db`
    SELECT o.id, o.name, o.created_at, m.role
    FROM organisations o
    JOIN organisation_members m ON m.organisation_id = o.id
    WHERE m.user_id = ${userId}
  `;

  if (results.length === 0) return null;

  return {
    organisation: toOrganisation(results[0]),
    role: results[0].role as OrganisationRole,
  };
};

export const getOrganisationMembers = async (
  organisationId: string,
): Promise<OrganisationMember[]> => {
  const results = await db`
    SELECT m.user_id, u.email, m.role, m.created_at
    FROM organisation_members m
    JOIN users u ON u.id = m.user_id
    WHERE m.organisation_id = ${organisationId}
    ORDER BY m.created_at
  `;

  return results.map((row: OrganisationMember) => ({
    user_id: row.user_id,
    email: row.email,
    role: row.role,
    created_at: new Date(row.created_at),
  }));
};

export type CreateInviteResult =
  | { success: true; invite: OrganisationInvite; rawToken: string }
  | { success: false; error: "already-member" | "already-invited" };

/**
 * Mint an invite and return the raw token, which exists only in the email that
 * carries it — the table stores its HMAC, exactly as user_tokens does.
 */
export const createInvite = async (
  organisationId: string,
  email: string,
  invitedBy: string,
): Promise<CreateInviteResult> => {
  const normalizedEmail = email.toLowerCase().trim();

  const existingMember = await db`
    SELECT 1
    FROM organisation_members m
    JOIN users u ON u.id = m.user_id
    WHERE m.organisation_id = ${organisationId} AND u.email = ${normalizedEmail}
  `;

  if (existingMember.length > 0) {
    return { success: false, error: "already-member" };
  }

  const rawToken = generateSecureToken(32);
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

  try {
    const inserted = await db`
      INSERT INTO organisation_invites
        (id, organisation_id, email, token_hash, invited_by, expires_at)
      VALUES (
        ${randomUUID()},
        ${organisationId},
        ${normalizedEmail},
        ${computeHMAC(rawToken)},
        ${invitedBy},
        ${expiresAt.toISOString()}
      )
      RETURNING id, organisation_id, email, expires_at, created_at
    `;

    const row = inserted[0];

    return {
      success: true,
      invite: {
        id: row.id,
        organisation_id: row.organisation_id,
        email: row.email,
        expires_at: new Date(row.expires_at),
        created_at: new Date(row.created_at),
      },
      rawToken,
    };
  } catch {
    // The partial unique index on (organisation_id, email) where accepted_at is
    // null: there is already a live invite for this address.
    return { success: false, error: "already-invited" };
  }
};

export const listPendingInvites = async (
  organisationId: string,
): Promise<OrganisationInvite[]> => {
  const results = await db`
    SELECT id, organisation_id, email, expires_at, created_at
    FROM organisation_invites
    WHERE organisation_id = ${organisationId}
      AND accepted_at IS NULL
      AND expires_at > CURRENT_TIMESTAMP
    ORDER BY created_at DESC
  `;

  return results.map((row: OrganisationInvite) => ({
    id: row.id,
    organisation_id: row.organisation_id,
    email: row.email,
    expires_at: new Date(row.expires_at),
    created_at: new Date(row.created_at),
  }));
};

/** Scoped to the organisation so an owner can't revoke another org's invite. */
export const revokeInvite = async (
  organisationId: string,
  inviteId: string,
): Promise<boolean> => {
  const result = await db`
    DELETE FROM organisation_invites
    WHERE id = ${inviteId}
      AND organisation_id = ${organisationId}
      AND accepted_at IS NULL
  `;

  return hasAffectedRows(result as DatabaseMutationResult);
};

export interface PendingInvite {
  id: string;
  organisation_id: string;
  organisation_name: string;
  email: string;
}

/**
 * Look up a live invite without spending it, so the acceptance page can name the
 * organisation and greet the right address before anyone submits anything.
 */
export const findPendingInvite = async (
  rawToken: string,
): Promise<PendingInvite | null> => {
  const results = await db`
    SELECT i.id, i.organisation_id, o.name AS organisation_name, i.email
    FROM organisation_invites i
    JOIN organisations o ON o.id = i.organisation_id
    WHERE i.token_hash = ${computeHMAC(rawToken)}
      AND i.accepted_at IS NULL
      AND i.expires_at > CURRENT_TIMESTAMP
  `;

  return results.length > 0 ? (results[0] as PendingInvite) : null;
};

/**
 * Claim an invite. The single UPDATE ... RETURNING is what makes this race-safe,
 * copied from consumeUserToken: two concurrent acceptances both try to flip
 * accepted_at from NULL and only one gets a row back.
 *
 * Claiming happens before the account is built, on purpose. A burned invite with
 * no account is recoverable — the owner sends another. An account with no
 * organisation is what the boot guard refuses to start on.
 */
export const consumeInvite = async (
  rawToken: string,
): Promise<PendingInvite | null> => {
  const results = await db`
    UPDATE organisation_invites
    SET accepted_at = CURRENT_TIMESTAMP
    WHERE token_hash = ${computeHMAC(rawToken)}
      AND accepted_at IS NULL
      AND expires_at > CURRENT_TIMESTAMP
    RETURNING id, organisation_id, email
  `;

  if (results.length === 0) return null;

  const organisation = await db`
    SELECT name FROM organisations WHERE id = ${results[0].organisation_id}
  `;

  return {
    id: results[0].id,
    organisation_id: results[0].organisation_id,
    organisation_name: organisation[0]?.name ?? "",
    email: results[0].email,
  };
};

/**
 * Refuse to boot when the flag is on and any user has no organisation.
 *
 * Nothing is guessed on the operator's behalf. Naming an organisation after
 * someone's email address invents data, and silently leaving those users
 * organisation-less would mean shipping an app whose central invariant — every
 * user belongs to exactly one — is already false. Which affordance fits (a
 * backfill migration, an onboarding page, assignment by an admin) depends on the
 * app, so the app says what is wrong and stops.
 *
 * Runs after migrations rather than inside validateEnv, which cannot touch the
 * database — the organisation tables may not exist yet when it runs.
 */
export const assertOrganisationsReady = async (): Promise<void> => {
  if (!organisationsEnabled()) return;

  const orphaned = await countUsersWithoutOrganisation();
  if (orphaned === 0) return;

  log.error(
    "organisations",
    `ORGANISATIONS_ENABLED is on but ${orphaned} user(s) belong to no organisation`,
  );
  log.error(
    "organisations",
    "Sign-up creates an organisation for every new account, but existing users predate it. Decide what they should belong to — a backfill migration, an onboarding page, or assignment by an admin — then start again.",
  );
  process.exit(1);
};
