import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { testDatabase } from "../test-utils/database";
import { cleanupTestData } from "../test-utils/helpers";

const connection = testDatabase();

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

      // The refused org must never have been created in the first place.
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
        await db`
          UPDATE organization_members SET org_role = 'superuser'
          WHERE user_id = ${user.id}
        `;
      } catch {
        rejected = true;
      }

      expect(rejected).toBe(true);
    });

    test("nothing is added to the users table", async () => {
      // The whole point of membership being its own table: a fork that never
      // turns teams on has an untouched users schema, and dropping the feature
      // is three DROP TABLEs rather than a migration against account data.
      const columns = await db`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'users'
      `;

      const names = columns.map((row: { column_name: string }) =>
        row.column_name.toLowerCase(),
      );

      expect(names).not.toContain("org_id");
      expect(names).not.toContain("org_role");
      expect(names).not.toContain("org_joined_at");
    });

    test("a second membership for one user is rejected by the database", async () => {
      const { user } = await seedOwner();
      const outsider = await findOrCreateUser("outsider@example.com");
      const other = await createOrganizationForUser(outsider.id, "Other");
      if (!other.success) throw new Error("seed failed");

      let rejected = false;
      try {
        await db`
          INSERT INTO organization_members (organization_id, user_id, org_role)
          VALUES (${other.organization.id}, ${user.id}, 'member')
        `;
      } catch {
        rejected = true;
      }

      expect(rejected).toBe(true);
    });

    test("deleting the org clears membership instead of deleting accounts", async () => {
      const { user, org } = await seedOwner();

      await db`DELETE FROM organizations WHERE id = ${org.id}`;

      const rows = await db`SELECT id FROM users WHERE id = ${user.id}`;
      expect(rows.length).toBe(1);
      expect(await getMembership(user.id)).toBeNull();
    });

    test("deleting the account clears membership instead of the org", async () => {
      const { user, org } = await seedOwner();

      await db`DELETE FROM users WHERE id = ${user.id}`;

      const orgs = await db`SELECT id FROM organizations WHERE id = ${org.id}`;
      expect(orgs.length).toBe(1);
      expect(await listMembers(org.id)).toEqual([]);
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
      expect(members[0].joined_at).toBeInstanceOf(Date);
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
    test("drops the membership row and leaves the account intact", async () => {
      const { org } = await seedOwner();
      const member = await seedMember(org.id, "m@example.com", "member");

      expect(await removeMember(org.id, member.id)).toEqual({ success: true });

      const rows = await db`SELECT id FROM users WHERE id = ${member.id}`;
      expect(rows.length).toBe(1);
      expect(await getMembership(member.id)).toBeNull();
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

    // Repeated, because a single attempt is not a concurrency test — it is one
    // sample of an interleaving. The guard this covers was broken for the whole
    // life of the feature and this assertion passed anyway; run against the
    // unlocked statement it fails ~24 times in 25, so one round is a coin flip
    // weighted the wrong way. See the `FOR UPDATE` note in organizations.ts.
    test("concurrent removals cannot empty the org of owners", async () => {
      for (let round = 0; round < 10; round++) {
        const { user, org } = await seedOwner(`owner-${round}@example.com`);
        const second = await seedMember(
          org.id,
          `second-${round}@example.com`,
          "owner",
        );

        const [a, b] = await Promise.all([
          removeMember(org.id, user.id),
          removeMember(org.id, second.id),
        ]);

        // Whichever order they land in, exactly one must survive as owner.
        expect([a.success, b.success].filter(Boolean).length).toBe(1);
        expect(await countOwners(org.id)).toBe(1);
      }
    });

    test("concurrent demotions cannot empty the org of owners", async () => {
      for (let round = 0; round < 10; round++) {
        const { user, org } = await seedOwner(`demote-${round}@example.com`);
        const second = await seedMember(
          org.id,
          `demote-second-${round}@example.com`,
          "owner",
        );

        const [a, b] = await Promise.all([
          updateMemberRole(org.id, user.id, "member"),
          updateMemberRole(org.id, second.id, "member"),
        ]);

        expect([a.success, b.success].filter(Boolean).length).toBe(1);
        expect(await countOwners(org.id)).toBe(1);
      }
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
