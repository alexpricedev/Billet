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
  acceptInvite,
  consumeInvite,
  createInvite,
  listInvites,
  MAX_LIVE_INVITES_PER_ORG,
  peekInvite,
  revokeInvite,
} from "./invites";
import {
  createOrganizationForUser,
  getMembership,
  joinOrganization,
} from "./organizations";

const seedOrg = async (email = "owner@example.com", name = "Acme") => {
  const user = await findOrCreateUser(email);
  const result = await createOrganizationForUser(user.id, name);
  if (!result.success) throw new Error("failed to seed org");
  return { user, org: result.organization };
};

const invite = async (
  orgId: string,
  inviterId: string,
  email = "invitee@example.com",
) => {
  const result = await createInvite(orgId, email, "member", inviterId);
  if (!result.success) throw new Error(`invite failed: ${result.error}`);
  return result;
};

describe("Invites Service with PostgreSQL", () => {
  beforeEach(async () => {
    await cleanupTestData(db);
  });

  afterAll(async () => {
    await connection.end();
    mock.restore();
  });

  describe("createInvite", () => {
    test("stores only the hash, never the emailed token", async () => {
      const { user, org } = await seedOrg();

      const { rawToken } = await invite(org.id, user.id);

      const rows = await db`SELECT token_hash FROM organization_invites`;
      expect(rows.length).toBe(1);
      expect(rows[0].token_hash).not.toBe(rawToken);
      expect(rawToken.length).toBeGreaterThan(20);
    });

    test("normalises the address", async () => {
      const { user, org } = await seedOrg();

      const result = await createInvite(
        org.id,
        "  Invitee@Example.COM ",
        "admin",
        user.id,
      );

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.invite.email).toBe("invitee@example.com");
      expect(result.invite.org_role).toBe("admin");
    });

    test("refuses an address already in the org", async () => {
      const { user, org } = await seedOrg();

      expect(
        await createInvite(org.id, "owner@example.com", "member", user.id),
      ).toEqual({ success: false, error: "already-member" });
    });

    test("refuses an address that isn't one", async () => {
      const { user, org } = await seedOrg();

      expect(
        await createInvite(org.id, "not-an-address", "member", user.id),
      ).toEqual({ success: false, error: "invalid-email" });
    });

    test("re-inviting revokes the previous invite and kills its token", async () => {
      const { user, org } = await seedOrg();

      const first = await invite(org.id, user.id);
      const second = await invite(org.id, user.id);

      expect(second.rawToken).not.toBe(first.rawToken);
      expect(await peekInvite(first.rawToken)).toBeNull();
      expect(await peekInvite(second.rawToken)).not.toBeNull();

      // The list shows one pending invite, not two.
      expect((await listInvites(org.id)).length).toBe(1);
    });

    test("caps live invites per org", async () => {
      const { user, org } = await seedOrg();

      for (let i = 0; i < MAX_LIVE_INVITES_PER_ORG; i++) {
        await invite(org.id, user.id, `invitee-${i}@example.com`);
      }

      expect(
        await createInvite(
          org.id,
          "one-too-many@example.com",
          "member",
          user.id,
        ),
      ).toEqual({ success: false, error: "too-many-invites" });
    });
  });

  describe("listInvites", () => {
    test("hides expired, revoked and accepted invites", async () => {
      const { user, org } = await seedOrg();

      const expired = await invite(org.id, user.id, "expired@example.com");
      await db`
        UPDATE organization_invites
        SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 day'
        WHERE id = ${expired.invite.id}
      `;

      const revoked = await invite(org.id, user.id, "revoked@example.com");
      await revokeInvite(org.id, revoked.invite.id);

      const accepted = await invite(org.id, user.id, "accepted@example.com");
      await consumeInvite(accepted.rawToken);

      const live = await invite(org.id, user.id, "live@example.com");

      const pending = await listInvites(org.id);
      expect(pending.map((i) => i.email)).toEqual([live.invite.email]);
    });

    test("is scoped to one org", async () => {
      const { user, org } = await seedOrg();
      const other = await seedOrg("other@example.com", "Other");

      await invite(org.id, user.id, "ours@example.com");

      expect((await listInvites(other.org.id)).length).toBe(0);
    });
  });

  describe("revokeInvite", () => {
    test("kills the token", async () => {
      const { user, org } = await seedOrg();
      const created = await invite(org.id, user.id);

      expect(await revokeInvite(org.id, created.invite.id)).toBe(true);
      expect(await peekInvite(created.rawToken)).toBeNull();
      expect(await consumeInvite(created.rawToken)).toBeNull();
    });

    test("another org cannot revoke it", async () => {
      const { user, org } = await seedOrg();
      const other = await seedOrg("other@example.com", "Other");
      const created = await invite(org.id, user.id);

      expect(await revokeInvite(other.org.id, created.invite.id)).toBe(false);
      expect(await peekInvite(created.rawToken)).not.toBeNull();
    });
  });

  describe("peekInvite", () => {
    test("returns the org name without spending the token", async () => {
      const { user, org } = await seedOrg();
      const created = await invite(org.id, user.id);

      const preview = await peekInvite(created.rawToken);

      expect(preview).toEqual({
        organizationName: "Acme",
        email: "invitee@example.com",
        org_role: "member",
      });

      // Still spendable afterwards — that's the whole point.
      expect(await consumeInvite(created.rawToken)).not.toBeNull();
    });

    test("returns null for an unknown token", async () => {
      expect(await peekInvite("nope")).toBeNull();
    });
  });

  describe("consumeInvite", () => {
    test("is single-use", async () => {
      const { user, org } = await seedOrg();
      const created = await invite(org.id, user.id);

      expect(await consumeInvite(created.rawToken)).not.toBeNull();
      expect(await consumeInvite(created.rawToken)).toBeNull();
    });

    test("refuses an expired invite", async () => {
      const { user, org } = await seedOrg();
      const created = await invite(org.id, user.id);

      await db`
        UPDATE organization_invites
        SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second'
        WHERE id = ${created.invite.id}
      `;

      expect(await consumeInvite(created.rawToken)).toBeNull();
    });

    test("exactly one of two concurrent claims wins", async () => {
      const { user, org } = await seedOrg();
      const created = await invite(org.id, user.id);

      const results = await Promise.all([
        consumeInvite(created.rawToken),
        consumeInvite(created.rawToken),
      ]);

      expect(results.filter(Boolean).length).toBe(1);
    });
  });

  describe("acceptInvite", () => {
    test("creates the account, joins the org and verifies the address", async () => {
      const { user, org } = await seedOrg();
      const created = await invite(org.id, user.id);

      const result = await acceptInvite(created.rawToken, null);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.user.email).toBe("invitee@example.com");
      expect(result.organization.name).toBe("Acme");
      expect(result.user.email_verified_at).toBeInstanceOf(Date);

      const membership = await getMembership(result.user.id);
      expect(membership?.org.id).toBe(org.id);
      expect(membership?.role).toBe("member");
    });

    test("does not downgrade users.role — the two axes stay separate", async () => {
      const { user, org } = await seedOrg();
      await db`UPDATE users SET role = 'admin' WHERE id = ${user.id}`;

      const created = await invite(
        org.id,
        user.id,
        "platformadmin@example.com",
      );
      const target = await findOrCreateUser("platformadmin@example.com");
      await db`UPDATE users SET role = 'admin' WHERE id = ${target.id}`;

      const result = await acceptInvite(created.rawToken, null);
      expect(result.success).toBe(true);

      // The platform flag lives on users, the org role on the membership row.
      // Nothing about joining an org may reach into the other axis.
      const rows = await db`SELECT role FROM users WHERE id = ${target.id}`;
      expect(rows[0].role).toBe("admin");
      expect((await getMembership(target.id))?.role).toBe("member");
    });

    test("refuses when signed in as a different person", async () => {
      const { user, org } = await seedOrg();
      const created = await invite(org.id, user.id);
      const someoneElse = await findOrCreateUser("someone@example.com");

      expect(await acceptInvite(created.rawToken, someoneElse.id)).toEqual({
        success: false,
        error: "email-mismatch",
      });

      // The token must survive a refused attempt.
      expect(await peekInvite(created.rawToken)).not.toBeNull();
    });

    test("refuses when the signed-in user already has an org", async () => {
      const { user, org } = await seedOrg();
      const other = await seedOrg("invitee@example.com", "Other");

      const created = await invite(org.id, user.id, "invitee@example.com");

      expect(await acceptInvite(created.rawToken, other.user.id)).toEqual({
        success: false,
        error: "already-in-org",
      });
      expect(await peekInvite(created.rawToken)).not.toBeNull();
    });

    test("refuses when the invited account joined another org meanwhile", async () => {
      const { user, org } = await seedOrg();
      const other = await seedOrg("other@example.com", "Other");
      const created = await invite(org.id, user.id);

      // The invitee signs up and joins elsewhere before clicking the link.
      const invitee = await findOrCreateUser("invitee@example.com");
      await joinOrganization(invitee.id, other.org.id, "member");

      expect(await acceptInvite(created.rawToken, null)).toEqual({
        success: false,
        error: "already-in-org",
      });
      expect((await getMembership(invitee.id))?.org.id).toBe(other.org.id);
    });

    test("refuses an unknown token", async () => {
      expect(await acceptInvite("nope", null)).toEqual({
        success: false,
        error: "invalid-token",
      });
    });
  });
});
