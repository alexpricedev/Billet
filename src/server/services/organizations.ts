import { randomUUID } from "node:crypto";
import { db } from "./database";

// The org-level role. A separate axis from `users.role`, which is the platform
// operator flag gating /admin — an org owner is not a platform admin, and
// collapsing the two would make every support grant a data grant.
export type OrgRole = "owner" | "admin" | "member";

export const ORG_ROLES: readonly OrgRole[] = ["owner", "admin", "member"];

export const isOrgRole = (value: string | undefined): value is OrgRole =>
  ORG_ROLES.includes(value as OrgRole);

const ORG_ROLE_RANK: Record<OrgRole, number> = {
  member: 0,
  admin: 1,
  owner: 2,
};

/**
 * Whether `role` meets `minimum`.
 *
 * Exported because the templates decide which controls to render from the same
 * ordering the guard enforces. A second hand-rolled comparison is how the two
 * drift apart and a button appears for something the server refuses.
 */
export const atLeast = (role: OrgRole, minimum: OrgRole): boolean =>
  ORG_ROLE_RANK[role] >= ORG_ROLE_RANK[minimum];

export const MAX_ORG_NAME_LENGTH = 100;

export interface Organization {
  id: string;
  name: string;
  created_at: Date;
}

/** A member as the management page needs them: the user row plus their role. */
export interface Member {
  id: string;
  email: string;
  org_role: OrgRole;
  org_joined_at: Date;
  email_verified_at: Date | null;
  created_at: Date;
}

export interface Membership {
  org: Organization;
  role: OrgRole;
  joinedAt: Date;
}

// Same rule as toUser in auth.ts: every query that selects an org goes through
// this, so a timestamp from the driver can never reach a template still typed
// as a string.
const toOrganization = (row: {
  id: string;
  name: string;
  created_at: string | Date;
}): Organization => ({
  id: row.id,
  name: row.name,
  created_at: new Date(row.created_at),
});

const toMember = (row: {
  id: string;
  email: string;
  org_role: OrgRole;
  org_joined_at: string | Date;
  email_verified_at: string | Date | null;
  created_at: string | Date;
}): Member => ({
  id: row.id,
  email: row.email,
  org_role: row.org_role,
  org_joined_at: new Date(row.org_joined_at),
  email_verified_at: row.email_verified_at
    ? new Date(row.email_verified_at)
    : null,
  created_at: new Date(row.created_at),
});

export const validateOrgName = (name: string): string | null => {
  const trimmed = name.trim();

  if (trimmed.length === 0) {
    return "Team name is required";
  }

  if (trimmed.length > MAX_ORG_NAME_LENGTH) {
    return `Team name must be ${MAX_ORG_NAME_LENGTH} characters or fewer`;
  }

  return null;
};

/**
 * The org this user belongs to, or null.
 *
 * This is the seam a fork scopes its own data on: add an org_id column to your
 * own tables and filter on the id this returns. It is read per request rather
 * than stamped onto the session row, so removing a member takes effect on their
 * very next request instead of whenever their session happens to expire.
 */
export const getMembership = async (
  userId: string,
): Promise<Membership | null> => {
  const results = await db`
    SELECT o.id, o.name, o.created_at, u.org_role, u.org_joined_at
    FROM users u
    JOIN organizations o ON o.id = u.org_id
    WHERE u.id = ${userId}
  `;

  if (results.length === 0) return null;

  const row = results[0];

  return {
    org: toOrganization(row),
    role: row.org_role as OrgRole,
    joinedAt: new Date(row.org_joined_at),
  };
};

export const listMembers = async (orgId: string): Promise<Member[]> => {
  const results = await db`
    SELECT id, email, org_role, org_joined_at, email_verified_at, created_at
    FROM users
    WHERE org_id = ${orgId}
    ORDER BY org_joined_at ASC
  `;

  return results.map(toMember);
};

export const countOwners = async (orgId: string): Promise<number> => {
  const [{ count }] = await db`
    SELECT count(*)::int AS count
    FROM users
    WHERE org_id = ${orgId} AND org_role = 'owner'
  `;

  return count as number;
};

export type CreateOrgResult =
  | { success: true; organization: Organization }
  | { success: false; error: "already-in-org" | "invalid-name" };

/**
 * Create an org and make the caller its owner.
 *
 * The UPDATE guards on `org_id IS NULL` rather than reading first: someone who
 * submits the create form in one tab and accepts an invite in another must not
 * end up in both, and a check-then-write leaves exactly that window open.
 */
export const createOrganizationForUser = async (
  userId: string,
  name: string,
): Promise<CreateOrgResult> => {
  if (validateOrgName(name)) {
    return { success: false, error: "invalid-name" };
  }

  const orgId = randomUUID();

  const created = await db`
    INSERT INTO organizations (id, name)
    VALUES (${orgId}, ${name.trim()})
    RETURNING id, name, created_at
  `;

  const claimed = await db`
    UPDATE users
    SET org_id = ${orgId},
        org_role = 'owner',
        org_joined_at = CURRENT_TIMESTAMP
    WHERE id = ${userId}
      AND org_id IS NULL
    RETURNING id
  `;

  if (claimed.length === 0) {
    // Lost the race, or the caller already had an org. The org row we just
    // created has nobody in it, so it would otherwise linger forever.
    await db`DELETE FROM organizations WHERE id = ${orgId}`;
    return { success: false, error: "already-in-org" };
  }

  return { success: true, organization: toOrganization(created[0]) };
};

export const renameOrg = async (orgId: string, name: string): Promise<void> => {
  await db`
    UPDATE organizations
    SET name = ${name.trim()}
    WHERE id = ${orgId}
  `;
};

export type RoleChangeResult =
  | { success: true }
  | { success: false; error: "not-a-member" | "last-owner" };

/**
 * Change a member's org role.
 *
 * "At least one owner" cannot be a constraint — SQL can express *at most* one
 * of something via a partial unique index, which is the opposite — so it is a
 * guard, and it has to live inside the statement. Two owners each demoting the
 * other in parallel would both pass a check-then-write and leave the org with
 * nobody who can administer it.
 *
 * Scoped by org_id as well as id: the caller has been proven an admin of *an*
 * org, not of the org this row belongs to.
 */
export const updateMemberRole = async (
  orgId: string,
  targetUserId: string,
  role: OrgRole,
): Promise<RoleChangeResult> => {
  const updated = await db`
    UPDATE users
    SET org_role = ${role}
    WHERE id = ${targetUserId}
      AND org_id = ${orgId}
      AND (
        org_role <> 'owner'
        OR ${role} = 'owner'
        OR EXISTS (
          SELECT 1 FROM users
          WHERE org_id = ${orgId}
            AND org_role = 'owner'
            AND id <> ${targetUserId}
        )
      )
    RETURNING id
  `;

  if (updated.length > 0) return { success: true };

  return { success: false, error: await whyRefused(orgId, targetUserId) };
};

export type RemoveMemberResult =
  | { success: true }
  | { success: false; error: "not-a-member" | "last-owner" };

/**
 * Remove someone from the org.
 *
 * All three columns are nulled together — `users_org_all_or_nothing` rejects a
 * partial update, so a half-removed member is impossible rather than merely
 * discouraged. The user row itself is untouched: this is identity management,
 * not account deletion.
 */
export const removeMember = async (
  orgId: string,
  targetUserId: string,
): Promise<RemoveMemberResult> => {
  const removed = await db`
    UPDATE users
    SET org_id = NULL,
        org_role = NULL,
        org_joined_at = NULL
    WHERE id = ${targetUserId}
      AND org_id = ${orgId}
      AND (
        org_role <> 'owner'
        OR EXISTS (
          SELECT 1 FROM users
          WHERE org_id = ${orgId}
            AND org_role = 'owner'
            AND id <> ${targetUserId}
        )
      )
    RETURNING id
  `;

  if (removed.length > 0) return { success: true };

  return { success: false, error: await whyRefused(orgId, targetUserId) };
};

/**
 * Why a guarded UPDATE matched nothing — for the message only, never for the
 * decision. The decision was already made, atomically, by the statement itself.
 */
const whyRefused = async (
  orgId: string,
  targetUserId: string,
): Promise<"not-a-member" | "last-owner"> => {
  const existing = await db`
    SELECT id FROM users
    WHERE id = ${targetUserId} AND org_id = ${orgId}
  `;

  return existing.length > 0 ? "last-owner" : "not-a-member";
};

/**
 * Put a user into an org. Used by invite acceptance, which has already proven
 * the invite is live and bound to this address.
 *
 * Guarded on `org_id IS NULL` for the same reason as createOrganizationForUser:
 * a second org must never silently replace the first.
 */
export const joinOrganization = async (
  userId: string,
  orgId: string,
  role: OrgRole,
): Promise<boolean> => {
  const joined = await db`
    UPDATE users
    SET org_id = ${orgId},
        org_role = ${role},
        org_joined_at = CURRENT_TIMESTAMP
    WHERE id = ${userId}
      AND org_id IS NULL
    RETURNING id
  `;

  return joined.length > 0;
};
