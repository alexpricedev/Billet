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
  joined_at: Date;
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
  joined_at: string | Date;
  email_verified_at: string | Date | null;
  created_at: string | Date;
}): Member => ({
  id: row.id,
  email: row.email,
  org_role: row.org_role,
  joined_at: new Date(row.joined_at),
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
    SELECT o.id, o.name, o.created_at, m.org_role, m.joined_at
    FROM organization_members m
    JOIN organizations o ON o.id = m.organization_id
    WHERE m.user_id = ${userId}
  `;

  if (results.length === 0) return null;

  const row = results[0];

  return {
    org: toOrganization(row),
    role: row.org_role as OrgRole,
    joinedAt: new Date(row.joined_at),
  };
};

export const listMembers = async (orgId: string): Promise<Member[]> => {
  const results = await db`
    SELECT u.id, u.email, m.org_role, m.joined_at,
           u.email_verified_at, u.created_at
    FROM organization_members m
    JOIN users u ON u.id = m.user_id
    WHERE m.organization_id = ${orgId}
    ORDER BY m.joined_at ASC
  `;

  return results.map(toMember);
};

export const countOwners = async (orgId: string): Promise<number> => {
  const [{ count }] = await db`
    SELECT count(*)::int AS count
    FROM organization_members
    WHERE organization_id = ${orgId} AND org_role = 'owner'
  `;

  return count as number;
};

export type CreateOrgResult =
  | { success: true; organization: Organization }
  | { success: false; error: "already-in-org" | "invalid-name" };

/**
 * Create an org and make the caller its owner.
 *
 * Both statements guard rather than read first: someone who submits the create
 * form in one tab and accepts an invite in another must not end up in both, and
 * a check-then-write leaves exactly that window open. The INSERT ... SELECT
 * WHERE NOT EXISTS means the ordinary "already in an org" answer never creates
 * an org row at all, and the ON CONFLICT below is the backstop for the narrow
 * race between the two — the only path that has anything to clean up.
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
    SELECT ${orgId}, ${name.trim()}
    WHERE NOT EXISTS (
      SELECT 1 FROM organization_members WHERE user_id = ${userId}
    )
    RETURNING id, name, created_at
  `;

  if (created.length === 0) {
    return { success: false, error: "already-in-org" };
  }

  const claimed = await db`
    INSERT INTO organization_members (organization_id, user_id, org_role)
    VALUES (${orgId}, ${userId}, 'owner')
    ON CONFLICT (user_id) DO NOTHING
    RETURNING id
  `;

  if (claimed.length === 0) {
    // Lost the race. The org row we just created has nobody in it, so it would
    // otherwise linger forever.
    await db`DELETE FROM organizations WHERE id = ${orgId}`;
    return { success: false, error: "already-in-org" };
  }

  return { success: true, organization: toOrganization(created[0]) };
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
 * Scoped by organization_id as well as user_id: the caller has been proven an
 * admin of *an* org, not of the org this row belongs to.
 */
/*
 * Both guarded statements below open with the same `FOR UPDATE` CTE, and it is
 * load-bearing rather than decoration.
 *
 * The guard used to be a bare `EXISTS (… another owner …)` inside the statement,
 * which reads as atomic and is not. Under Postgres's default READ COMMITTED,
 * two concurrent removals of the last two owners each see the *other* owner —
 * neither has committed — so both pass the check and both commit, leaving the
 * organisation with no owner and nobody able to administer it. Classic write
 * skew: row-level locking only serialises writes to the same row, and these
 * touch different rows.
 *
 * Locking the owner rows first closes it. The second transaction blocks on the
 * lock, and once the first commits its `FOR UPDATE` re-checks and drops the row
 * that was deleted — so it now sees one owner, fails the guard, and is refused.
 * `ORDER BY user_id` fixes the lock order so two callers can't deadlock by
 * taking the same rows in opposite orders.
 *
 * The cost is that removing a plain member also briefly locks the org's owner
 * rows, serialising unrelated changes to one org. On a team page that is
 * nothing, and the alternative is a guard that is only usually right.
 */
export const updateMemberRole = async (
  orgId: string,
  targetUserId: string,
  role: OrgRole,
): Promise<RoleChangeResult> => {
  const updated = await db`
    WITH owners AS (
      SELECT user_id FROM organization_members
      WHERE organization_id = ${orgId}
        AND org_role = 'owner'
      ORDER BY user_id
      FOR UPDATE
    )
    UPDATE organization_members
    SET org_role = ${role}
    WHERE user_id = ${targetUserId}
      AND organization_id = ${orgId}
      AND (
        org_role <> 'owner'
        OR ${role} = 'owner'
        OR EXISTS (SELECT 1 FROM owners WHERE user_id <> ${targetUserId})
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
 * Deleting the membership row is the whole operation, so a half-removed member
 * is unrepresentable rather than merely discouraged. The `users` row is not
 * touched at all: this is identity management, not account deletion.
 */
export const removeMember = async (
  orgId: string,
  targetUserId: string,
): Promise<RemoveMemberResult> => {
  const removed = await db`
    WITH owners AS (
      SELECT user_id FROM organization_members
      WHERE organization_id = ${orgId}
        AND org_role = 'owner'
      ORDER BY user_id
      FOR UPDATE
    )
    DELETE FROM organization_members
    WHERE user_id = ${targetUserId}
      AND organization_id = ${orgId}
      AND (
        org_role <> 'owner'
        OR EXISTS (SELECT 1 FROM owners WHERE user_id <> ${targetUserId})
      )
    RETURNING id
  `;

  if (removed.length > 0) return { success: true };

  return { success: false, error: await whyRefused(orgId, targetUserId) };
};

/**
 * Why a guarded statement matched nothing — for the message only, never for the
 * decision. The decision was already made, atomically, by the statement itself.
 */
const whyRefused = async (
  orgId: string,
  targetUserId: string,
): Promise<"not-a-member" | "last-owner"> => {
  const existing = await db`
    SELECT id FROM organization_members
    WHERE user_id = ${targetUserId} AND organization_id = ${orgId}
  `;

  return existing.length > 0 ? "last-owner" : "not-a-member";
};

/**
 * Put a user into an org. Used by invite acceptance, which has already proven
 * the invite is live and bound to this address.
 *
 * The UNIQUE on user_id is the guard, for the same reason as
 * createOrganizationForUser: a second org must never silently replace the
 * first, and DO NOTHING makes that the answer rather than an exception.
 */
export const joinOrganization = async (
  userId: string,
  orgId: string,
  role: OrgRole,
): Promise<boolean> => {
  const joined = await db`
    INSERT INTO organization_members (organization_id, user_id, org_role)
    VALUES (${orgId}, ${userId}, ${role})
    ON CONFLICT (user_id) DO NOTHING
    RETURNING id
  `;

  return joined.length > 0;
};
