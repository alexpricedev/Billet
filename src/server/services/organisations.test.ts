import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { SQL } from "bun";
import { cleanupTestData, randomEmail } from "../test-utils/helpers";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for tests");
}
const connection = new SQL(process.env.DATABASE_URL);

// Mock the database module before importing the service
mock.module("./database", () => ({
  get db() {
    return connection;
  },
}));

import { db } from "./database";
import {
  addMember,
  consumeInvite,
  countUsersWithoutOrganisation,
  createInvite,
  findPendingInvite,
  getOrganisationForUser,
  getOrganisationMembers,
  listPendingInvites,
  MAX_ORGANISATION_NAME_LENGTH,
  revokeInvite,
  signUpIntoOrganisation,
  signUpWithOrganisation,
  validateOrganisationName,
} from "./organisations";

describe("Organisations service with PostgreSQL", () => {
  beforeEach(async () => {
    await cleanupTestData(db);
  });

  afterAll(async () => {
    await connection.end();
    mock.restore();
  });

  describe("validateOrganisationName", () => {
    test("accepts a normal name", () => {
      expect(validateOrganisationName("Acme")).toBeNull();
    });

    test("rejects a name that is too short", () => {
      expect(validateOrganisationName("A")).toContain("at least");
      expect(validateOrganisationName("")).toContain("at least");
    });

    test("rejects a name that is too long", () => {
      const name = "a".repeat(MAX_ORGANISATION_NAME_LENGTH + 1);
      expect(validateOrganisationName(name)).toContain("or fewer");
    });
  });

  describe("signUpWithOrganisation", () => {
    test("creates the user, the organisation and an owner membership", async () => {
      const email = randomEmail();
      const result = await signUpWithOrganisation(email, "Acme");

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.user.email).toBe(email.toLowerCase());
      expect(result.organisation.name).toBe("Acme");

      const membership = await getOrganisationForUser(result.user.id);
      expect(membership?.organisation.id).toBe(result.organisation.id);
      expect(membership?.role).toBe("owner");
    });

    test("normalises the email", async () => {
      const email = randomEmail().toUpperCase();
      const result = await signUpWithOrganisation(email, "Acme");

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.user.email).toBe(email.toLowerCase());
    });

    test("stores the password hash when one is given", async () => {
      const result = await signUpWithOrganisation(
        randomEmail(),
        "Acme",
        "hashed",
      );

      expect(result.success).toBe(true);
      if (!result.success) return;

      const rows =
        await db`SELECT password_hash FROM users WHERE id = ${result.user.id}`;
      expect(rows[0].password_hash).toBe("hashed");
    });

    test("rejects a taken email and leaves no organisation behind", async () => {
      const email = randomEmail();
      await signUpWithOrganisation(email, "First");

      const second = await signUpWithOrganisation(email, "Second");
      expect(second.success).toBe(false);

      // The whole point of the transaction: the losing sign-up must not leave an
      // orphan organisation lying around.
      const orgs = await db`SELECT id FROM organisations WHERE name = 'Second'`;
      expect(orgs.length).toBe(0);
    });
  });

  describe("one organisation per user", () => {
    test("a second membership is refused", async () => {
      const owner = await signUpWithOrganisation(randomEmail(), "Acme");
      const other = await signUpWithOrganisation(randomEmail(), "Other");
      if (!owner.success || !other.success) throw new Error("setup failed");

      const joined = await addMember(other.organisation.id, owner.user.id);
      expect(joined).toBe(false);

      // Still in the original organisation, unchanged.
      const membership = await getOrganisationForUser(owner.user.id);
      expect(membership?.organisation.id).toBe(owner.organisation.id);
    });
  });

  describe("countUsersWithoutOrganisation", () => {
    test("is zero when every user signed up with one", async () => {
      await signUpWithOrganisation(randomEmail(), "Acme");
      expect(await countUsersWithoutOrganisation()).toBe(0);
    });

    test("counts users created without one", async () => {
      await db`INSERT INTO users (id, email) VALUES (gen_random_uuid(), ${randomEmail()})`;
      await db`INSERT INTO users (id, email) VALUES (gen_random_uuid(), ${randomEmail()})`;
      await signUpWithOrganisation(randomEmail(), "Acme");

      expect(await countUsersWithoutOrganisation()).toBe(2);
    });
  });

  describe("getOrganisationMembers", () => {
    test("lists everyone in the organisation, owner first", async () => {
      const owner = await signUpWithOrganisation(randomEmail(), "Acme");
      if (!owner.success) throw new Error("setup failed");

      const memberEmail = randomEmail();
      await signUpIntoOrganisation(memberEmail, owner.organisation.id);

      const members = await getOrganisationMembers(owner.organisation.id);
      expect(members.length).toBe(2);
      expect(members[0].role).toBe("owner");
      expect(members[1].role).toBe("member");
      expect(members[1].email).toBe(memberEmail.toLowerCase());
    });

    test("does not leak members of another organisation", async () => {
      const a = await signUpWithOrganisation(randomEmail(), "A");
      await signUpWithOrganisation(randomEmail(), "B");
      if (!a.success) throw new Error("setup failed");

      expect((await getOrganisationMembers(a.organisation.id)).length).toBe(1);
    });
  });

  describe("invites", () => {
    const setupOwner = async () => {
      const owner = await signUpWithOrganisation(randomEmail(), "Acme");
      if (!owner.success) throw new Error("setup failed");
      return owner;
    };

    test("creates an invite and finds it by its raw token", async () => {
      const owner = await setupOwner();
      const invitee = randomEmail();

      const result = await createInvite(
        owner.organisation.id,
        invitee,
        owner.user.id,
      );
      expect(result.success).toBe(true);
      if (!result.success) return;

      const found = await findPendingInvite(result.rawToken);
      expect(found?.email).toBe(invitee.toLowerCase());
      expect(found?.organisation_name).toBe("Acme");
    });

    test("stores only the hash of the token", async () => {
      const owner = await setupOwner();
      const result = await createInvite(
        owner.organisation.id,
        randomEmail(),
        owner.user.id,
      );
      if (!result.success) throw new Error("setup failed");

      const rows = await db`SELECT token_hash FROM organisation_invites`;
      expect(rows[0].token_hash).not.toBe(result.rawToken);
    });

    test("refuses to invite an existing member", async () => {
      const owner = await setupOwner();
      const result = await createInvite(
        owner.organisation.id,
        owner.user.email,
        owner.user.id,
      );

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toBe("already-member");
    });

    test("refuses a second live invite to the same address", async () => {
      const owner = await setupOwner();
      const invitee = randomEmail();

      await createInvite(owner.organisation.id, invitee, owner.user.id);
      const second = await createInvite(
        owner.organisation.id,
        invitee,
        owner.user.id,
      );

      expect(second.success).toBe(false);
      if (second.success) return;
      expect(second.error).toBe("already-invited");
    });

    test("cannot be consumed twice", async () => {
      const owner = await setupOwner();
      const result = await createInvite(
        owner.organisation.id,
        randomEmail(),
        owner.user.id,
      );
      if (!result.success) throw new Error("setup failed");

      expect(await consumeInvite(result.rawToken)).not.toBeNull();
      expect(await consumeInvite(result.rawToken)).toBeNull();
    });

    test("an expired invite is neither findable nor consumable", async () => {
      const owner = await setupOwner();
      const result = await createInvite(
        owner.organisation.id,
        randomEmail(),
        owner.user.id,
      );
      if (!result.success) throw new Error("setup failed");

      await db`
        UPDATE organisation_invites
        SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 day'
      `;

      expect(await findPendingInvite(result.rawToken)).toBeNull();
      expect(await consumeInvite(result.rawToken)).toBeNull();
    });

    test("a garbage token finds nothing", async () => {
      expect(await findPendingInvite("not-a-real-token")).toBeNull();
    });

    test("listPendingInvites hides accepted ones", async () => {
      const owner = await setupOwner();
      const kept = await createInvite(
        owner.organisation.id,
        randomEmail(),
        owner.user.id,
      );
      const spent = await createInvite(
        owner.organisation.id,
        randomEmail(),
        owner.user.id,
      );
      if (!kept.success || !spent.success) throw new Error("setup failed");

      await consumeInvite(spent.rawToken);

      const pending = await listPendingInvites(owner.organisation.id);
      expect(pending.length).toBe(1);
      expect(pending[0].id).toBe(kept.invite.id);
    });

    test("revoking removes the invite", async () => {
      const owner = await setupOwner();
      const result = await createInvite(
        owner.organisation.id,
        randomEmail(),
        owner.user.id,
      );
      if (!result.success) throw new Error("setup failed");

      expect(await revokeInvite(owner.organisation.id, result.invite.id)).toBe(
        true,
      );
      expect(await findPendingInvite(result.rawToken)).toBeNull();
    });

    test("cannot revoke another organisation's invite", async () => {
      const owner = await setupOwner();
      const other = await signUpWithOrganisation(randomEmail(), "Other");
      if (!other.success) throw new Error("setup failed");

      const result = await createInvite(
        owner.organisation.id,
        randomEmail(),
        owner.user.id,
      );
      if (!result.success) throw new Error("setup failed");

      expect(await revokeInvite(other.organisation.id, result.invite.id)).toBe(
        false,
      );
      expect(await findPendingInvite(result.rawToken)).not.toBeNull();
    });

    test("revoking an invite frees the address to be re-invited", async () => {
      const owner = await setupOwner();
      const invitee = randomEmail();

      const first = await createInvite(
        owner.organisation.id,
        invitee,
        owner.user.id,
      );
      if (!first.success) throw new Error("setup failed");
      await revokeInvite(owner.organisation.id, first.invite.id);

      const second = await createInvite(
        owner.organisation.id,
        invitee,
        owner.user.id,
      );
      expect(second.success).toBe(true);
    });
  });

  describe("signUpIntoOrganisation", () => {
    test("creates a member of an existing organisation", async () => {
      const owner = await signUpWithOrganisation(randomEmail(), "Acme");
      if (!owner.success) throw new Error("setup failed");

      const email = randomEmail();
      const joined = await signUpIntoOrganisation(email, owner.organisation.id);

      expect(joined.success).toBe(true);
      if (!joined.success) return;

      const membership = await getOrganisationForUser(joined.user.id);
      expect(membership?.organisation.id).toBe(owner.organisation.id);
      expect(membership?.role).toBe("member");
    });

    test("rejects a taken email", async () => {
      const owner = await signUpWithOrganisation(randomEmail(), "Acme");
      if (!owner.success) throw new Error("setup failed");

      const taken = await signUpIntoOrganisation(
        owner.user.email,
        owner.organisation.id,
      );
      expect(taken.success).toBe(false);
    });
  });

  describe("getOrganisationForUser", () => {
    test("returns null for a user in no organisation", async () => {
      const rows =
        await db`INSERT INTO users (id, email) VALUES (gen_random_uuid(), ${randomEmail()}) RETURNING id`;
      expect(await getOrganisationForUser(rows[0].id)).toBeNull();
    });
  });
});
