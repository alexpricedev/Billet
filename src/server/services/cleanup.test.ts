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
import { runCleanupSweep, startCleanupSweep } from "./cleanup";
import { db } from "./database";
import { createInvite } from "./invites";
import { createOrganizationForUser } from "./organizations";

const HOUR = 60 * 60 * 1000;

const insertSession = async (
  idHash: string,
  userId: string | null,
  expiresAt: Date,
) => {
  await db`
    INSERT INTO sessions (id_hash, user_id, session_type, expires_at)
    VALUES (
      ${idHash},
      ${userId},
      ${userId ? "authenticated" : "guest"},
      ${expiresAt.toISOString()}
    )
  `;
};

const insertToken = async (
  userId: string,
  tokenHash: string,
  expiresAt: Date,
) => {
  await db`
    INSERT INTO user_tokens (user_id, token_hash, type, expires_at)
    VALUES (${userId}, ${tokenHash}, ${"magic_link"}, ${expiresAt.toISOString()})
  `;
};

const seedOrg = async (email = "owner@example.com") => {
  const user = await findOrCreateUser(email);
  const result = await createOrganizationForUser(user.id, "Acme");
  if (!result.success) throw new Error("failed to seed org");
  return { user, org: result.organization };
};

/** Move an invite's expiry into the past without touching anything else. */
const expireInvite = async (id: string) => {
  await db`
    UPDATE organization_invites
    SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 day'
    WHERE id = ${id}
  `;
};

describe("Cleanup sweep", () => {
  const originalTeams = process.env.TEAMS_ENABLED;

  beforeEach(async () => {
    process.env.TEAMS_ENABLED = originalTeams;
    await cleanupTestData(db);
  });

  afterAll(async () => {
    process.env.TEAMS_ENABLED = originalTeams;
    await connection.end();
    mock.restore();
  });

  describe("user_tokens", () => {
    test("deletes expired tokens and keeps live ones", async () => {
      const user = await findOrCreateUser("tokens@example.com");
      await insertToken(user.id, "expired-hash", new Date(Date.now() - HOUR));
      await insertToken(user.id, "live-hash", new Date(Date.now() + HOUR));

      await runCleanupSweep();

      const rows = await db`SELECT token_hash FROM user_tokens`;
      expect(rows.map((row: { token_hash: string }) => row.token_hash)).toEqual(
        ["live-hash"],
      );
    });

    test("deletes a spent token once it expires", async () => {
      const user = await findOrCreateUser("spent@example.com");
      await insertToken(user.id, "spent-hash", new Date(Date.now() - HOUR));
      await db`UPDATE user_tokens SET used_at = CURRENT_TIMESTAMP`;

      await runCleanupSweep();

      const rows = await db`SELECT id FROM user_tokens`;
      expect(rows.length).toBe(0);
    });
  });

  describe("sessions", () => {
    test("deletes expired sessions and keeps live ones", async () => {
      const user = await findOrCreateUser("sessions@example.com");
      await insertSession("expired-auth", user.id, new Date(Date.now() - HOUR));
      await insertSession("live-auth", user.id, new Date(Date.now() + HOUR));

      await runCleanupSweep();

      const rows = await db`SELECT id_hash FROM sessions`;
      expect(rows.map((row: { id_hash: string }) => row.id_hash)).toEqual([
        "live-auth",
      ]);
    });

    test("deletes expired guest sessions", async () => {
      await insertSession("expired-guest", null, new Date(Date.now() - HOUR));

      await runCleanupSweep();

      const rows = await db`SELECT id_hash FROM sessions`;
      expect(rows.length).toBe(0);
    });

    test("leaves the user the session belonged to alone", async () => {
      const user = await findOrCreateUser("keepme@example.com");
      await insertSession("expired-auth", user.id, new Date(Date.now() - HOUR));

      await runCleanupSweep();

      const rows = await db`SELECT id FROM users WHERE id = ${user.id}`;
      expect(rows.length).toBe(1);
    });
  });

  describe("organization_invites", () => {
    test("deletes expired unaccepted invites when teams are enabled", async () => {
      process.env.TEAMS_ENABLED = "true";
      const { user, org } = await seedOrg();

      const expired = await createInvite(
        org.id,
        "expired@example.com",
        "member",
        user.id,
      );
      const live = await createInvite(
        org.id,
        "live@example.com",
        "member",
        user.id,
      );
      if (!expired.success || !live.success) throw new Error("seed failed");
      await expireInvite(expired.invite.id);

      await runCleanupSweep();

      const rows = await db`SELECT email FROM organization_invites`;
      expect(rows.map((row: { email: string }) => row.email)).toEqual([
        "live@example.com",
      ]);
    });

    test("deletes an expired revoked invite", async () => {
      process.env.TEAMS_ENABLED = "true";
      const { user, org } = await seedOrg();

      const result = await createInvite(
        org.id,
        "revoked@example.com",
        "member",
        user.id,
      );
      if (!result.success) throw new Error("seed failed");
      await db`
        UPDATE organization_invites
        SET revoked_at = CURRENT_TIMESTAMP
        WHERE id = ${result.invite.id}
      `;
      await expireInvite(result.invite.id);

      await runCleanupSweep();

      const rows = await db`SELECT id FROM organization_invites`;
      expect(rows.length).toBe(0);
    });

    // Migration 008 keeps accepted invites as the record of who joined via whom.
    test("keeps an accepted invite after it expires", async () => {
      process.env.TEAMS_ENABLED = "true";
      const { user, org } = await seedOrg();

      const result = await createInvite(
        org.id,
        "accepted@example.com",
        "member",
        user.id,
      );
      if (!result.success) throw new Error("seed failed");
      await db`
        UPDATE organization_invites
        SET accepted_at = CURRENT_TIMESTAMP
        WHERE id = ${result.invite.id}
      `;
      await expireInvite(result.invite.id);

      await runCleanupSweep();

      const rows = await db`SELECT email FROM organization_invites`;
      expect(rows.map((row: { email: string }) => row.email)).toEqual([
        "accepted@example.com",
      ]);
    });

    test("does not touch invites when teams are disabled", async () => {
      process.env.TEAMS_ENABLED = "true";
      const { user, org } = await seedOrg();
      const result = await createInvite(
        org.id,
        "expired@example.com",
        "member",
        user.id,
      );
      if (!result.success) throw new Error("seed failed");
      await expireInvite(result.invite.id);

      process.env.TEAMS_ENABLED = "false";
      await runCleanupSweep();

      const rows = await db`SELECT id FROM organization_invites`;
      expect(rows.length).toBe(1);
    });

    test("still sweeps auth tables when teams are disabled", async () => {
      process.env.TEAMS_ENABLED = "false";
      const user = await findOrCreateUser("noteams@example.com");
      await insertToken(user.id, "expired-hash", new Date(Date.now() - HOUR));

      await runCleanupSweep();

      const rows = await db`SELECT id FROM user_tokens`;
      expect(rows.length).toBe(0);
    });
  });

  describe("startCleanupSweep", () => {
    test("sweeps once immediately and returns a stop handle", async () => {
      const user = await findOrCreateUser("timer@example.com");
      await insertToken(user.id, "expired-hash", new Date(Date.now() - HOUR));

      const stop = startCleanupSweep();
      try {
        // The first sweep is fired without being awaited, so give its promise a
        // turn of the loop before asserting.
        await new Promise((resolve) => setTimeout(resolve, 100));

        const rows = await db`SELECT id FROM user_tokens`;
        expect(rows.length).toBe(0);
      } finally {
        stop();
      }
    });

    test("is idempotent — a second sweep over swept tables is a no-op", async () => {
      await runCleanupSweep();
      await runCleanupSweep();

      const rows = await db`SELECT id_hash FROM sessions`;
      expect(rows.length).toBe(0);
    });
  });
});
