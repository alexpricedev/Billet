import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { SQL } from "bun";
import { cleanupTestData } from "../test-utils/helpers";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for tests");
}
const connection = new SQL(process.env.DATABASE_URL);

mock.module("./database", () => ({
  get db() {
    return connection;
  },
}));

import { findOrCreateUser } from "./auth";
import { db } from "./database";
import {
  atLeast,
  countOwners,
  createOrganizationForUser,
  getMembership,
  isOrgRole,
  joinOrganization,
  listMembers,
  removeMember,
  updateMemberRole,
  validateOrgName,
} from "./organizations";

const seedOwner = async (email = "owner@example.com") => {
  const user = await findOrCreateUser(email);
  const result = await createOrganizationForUser(user.id, "Acme");

  if (!result.success) throw new Error("failed to seed owner");

  return { user, org: result.organization };
};

const seedMember = async (
  orgId: string,
  email: string,
  role: "owner" | "admin" | "member",
) => {
  const user = await findOrCreateUser(email);
  await joinOrganization(user.id, orgId, role);
  return user;
};

describe("Organizations Service with PostgreSQL", () => {
  beforeEach(async () => {
    await cleanupTestData(db);
  });

  afterAll(async () => {
    await connection.end();
    mock.restore();
  });

  describe("role helpers", () => {
    test("atLeast ranks owner above admin above member", () => {
      expect(atLeast("owner", "admin")).toBe(true);
      expect(atLeast("admin", "admin")).toBe(true);
      expect(atLeast("member", "admin")).toBe(false);
      expect(atLeast("member", "member")).toBe(true);
      expect(atLeast("admin", "owner")).toBe(false);
    });

    test("isOrgRole rejects anything outside the three", () => {
      expect(isOrgRole("owner")).toBe(true);
      expect(isOrgRole("user")).toBe(false);
      expect(isOrgRole("Admin")).toBe(false);
      expect(isOrgRole(undefined)).toBe(false);
    });

    test("validateOrgName requires a name within the cap", () => {
      expect(validateOrgName("Acme")).toBeNull();
      expect(validateOrgName("   ")).not.toBeNull();
      expect(validateOrgName("x".repeat(101))).not.toBeNull();
    });
  });

  describe("createOrganizationForUser", () => {
    test("creates the org and makes the caller its owner", async () => {
      const { user, org } = await seedOwner();

      const membership = await getMembership(user.id);

      expect(membership?.org.id).toBe(org.id);
      expect(membership?.org.name).toBe("Acme");
      expect(membership?.role).toBe("owner");
      expect(membership?.joinedAt).toBeInstanceOf(Date);
    });

    test("refuses a second org and leaves no orphan behind", async () => {
      const { user } = await seedOwner();

      const second = await createOrganizationForUser(user.id, "Other");

      expect(second).toEqual({ success: false, error: "already-in-org" });

      // The losing org row must not linger with nobody in it.
      const orgs = await db`SELECT id FROM organizations`;
      expect(orgs.length).toBe(1);
    });

    test("rejects an invalid name before writing anything", async () => {
      const user = await findOrCreateUser("noname@example.com");

      const result = await createOrganizationForUser(user.id, "   ");

      expect(result).toEqual({ success: false, error: "invalid-name" });
      expect((await db`SELECT id FROM organizations`).length).toBe(0);
    });
  });

  describe("schema constraints", () => {
    // try/catch rather than expect().rejects: a Bun.SQL tagged template is a
    // lazy thenable, not a Promise, and .rejects never settles against one.
    test("the role CHECK rejects a value outside the three", async () => {
      const { user } = await seedOwner();

      let rejected = false;
      try {
        await db`UPDATE users SET org_role = 'superuser' WHERE id = ${user.id}`;
      } catch {
        rejected = true;
      }

      expect(rejected).toBe(true);
    });

    test("a partial update is rejected, so a half-removed member can't exist", async () => {
      const { user } = await seedOwner();

      // Nulling org_id alone is exactly the bug users_org_all_or_nothing exists
      // to make impossible.
      let rejected = false;
      try {
        await db`UPDATE users SET org_id = NULL WHERE id = ${user.id}`;
      } catch {
        rejected = true;
      }

      expect(rejected).toBe(true);
    });

    test("deleting the org clears membership instead of deleting accounts", async () => {
      const { user, org } = await seedOwner();

      await db`
        UPDATE users SET org_id = NULL, org_role = NULL, org_joined_at = NULL
        WHERE org_id = ${org.id}
      `;
      await db`DELETE FROM organizations WHERE id = ${org.id}`;

      const rows = await db`SELECT id, org_id FROM users WHERE id = ${user.id}`;
      expect(rows.length).toBe(1);
      expect(rows[0].org_id).toBeNull();
    });
  });

  describe("listMembers and countOwners", () => {
    test("lists only this org's members, oldest first", async () => {
      const { org } = await seedOwner();
      await seedMember(org.id, "member@example.com", "member");

      // A second org's member must not appear.
      const outsider = await findOrCreateUser("outsider@example.com");
      const other = await createOrganizationForUser(outsider.id, "Other");
      if (!other.success) throw new Error("seed failed");

      const members = await listMembers(org.id);

      expect(members.map((m) => m.email)).toEqual([
        "owner@example.com",
        "member@example.com",
      ]);
      expect(members[0].org_role).toBe("owner");
      expect(members[0].org_joined_at).toBeInstanceOf(Date);
    });

    test("counts owners in this org only", async () => {
      const { org } = await seedOwner();
      await seedMember(org.id, "second@example.com", "owner");
      await seedMember(org.id, "third@example.com", "member");

      expect(await countOwners(org.id)).toBe(2);
    });
  });

  describe("updateMemberRole", () => {
    test("promotes a member to admin", async () => {
      const { org } = await seedOwner();
      const member = await seedMember(org.id, "m@example.com", "member");

      expect(await updateMemberRole(org.id, member.id, "admin")).toEqual({
        success: true,
      });
      expect((await getMembership(member.id))?.role).toBe("admin");
    });

    test("refuses to demote the last owner", async () => {
      const { user, org } = await seedOwner();

      expect(await updateMemberRole(org.id, user.id, "member")).toEqual({
        success: false,
        error: "last-owner",
      });
      expect((await getMembership(user.id))?.role).toBe("owner");
    });

    test("allows demoting an owner once another owner exists", async () => {
      const { user, org } = await seedOwner();
      await seedMember(org.id, "second@example.com", "owner");

      expect(await updateMemberRole(org.id, user.id, "member")).toEqual({
        success: true,
      });
    });

    test("is scoped by org — another org's user is not a member", async () => {
      const { org } = await seedOwner();
      const outsider = await findOrCreateUser("outsider@example.com");
      const other = await createOrganizationForUser(outsider.id, "Other");
      if (!other.success) throw new Error("seed failed");

      expect(await updateMemberRole(org.id, outsider.id, "admin")).toEqual({
        success: false,
        error: "not-a-member",
      });
      expect((await getMembership(outsider.id))?.role).toBe("owner");
    });
  });

  describe("removeMember", () => {
    test("nulls all three columns and leaves the account intact", async () => {
      const { org } = await seedOwner();
      const member = await seedMember(org.id, "m@example.com", "member");

      expect(await removeMember(org.id, member.id)).toEqual({ success: true });

      const rows = await db`
        SELECT id, org_id, org_role, org_joined_at FROM users WHERE id = ${member.id}
      `;
      expect(rows.length).toBe(1);
      expect(rows[0].org_id).toBeNull();
      expect(rows[0].org_role).toBeNull();
      expect(rows[0].org_joined_at).toBeNull();
    });

    test("refuses to remove the last owner", async () => {
      const { user, org } = await seedOwner();

      expect(await removeMember(org.id, user.id)).toEqual({
        success: false,
        error: "last-owner",
      });
      expect(await getMembership(user.id)).not.toBeNull();
    });

    test("is scoped by org", async () => {
      const { org } = await seedOwner();
      const outsider = await findOrCreateUser("outsider@example.com");
      const other = await createOrganizationForUser(outsider.id, "Other");
      if (!other.success) throw new Error("seed failed");

      expect(await removeMember(org.id, outsider.id)).toEqual({
        success: false,
        error: "not-a-member",
      });
      expect(await getMembership(outsider.id)).not.toBeNull();
    });

    test("two concurrent removals cannot empty the org of owners", async () => {
      const { user, org } = await seedOwner();
      const second = await seedMember(org.id, "second@example.com", "owner");

      const [a, b] = await Promise.all([
        removeMember(org.id, user.id),
        removeMember(org.id, second.id),
      ]);

      // Whichever order they land in, exactly one must survive as owner.
      expect([a.success, b.success].filter(Boolean).length).toBe(1);
      expect(await countOwners(org.id)).toBe(1);
    });
  });

  describe("joinOrganization", () => {
    test("refuses to move someone who already has an org", async () => {
      const { user, org } = await seedOwner();
      const outsider = await findOrCreateUser("outsider@example.com");
      const other = await createOrganizationForUser(outsider.id, "Other");
      if (!other.success) throw new Error("seed failed");

      expect(
        await joinOrganization(user.id, other.organization.id, "member"),
      ).toBe(false);
      expect((await getMembership(user.id))?.org.id).toBe(org.id);
    });
  });
});
