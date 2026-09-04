import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { testDatabase } from "../test-utils/database";
import { cleanupTestData } from "../test-utils/helpers";

const connection = testDatabase();

mock.module("./database", () => ({
  get db() {
    return connection;
  },
}));

import {
  consumeUserToken,
  createMagicLink,
  createUserToken,
  findOrCreateUser,
  findUserByEmail,
  regenerateSession,
  verifyMagicLink,
} from "./auth";
import { db } from "./database";
import {
  createGuestSession,
  deleteSession,
  getSessionContextFromDB,
} from "./sessions";

describe("Auth Service with PostgreSQL", () => {
  beforeEach(async () => {
    await cleanupTestData(db);
  });

  afterAll(async () => {
    await connection.end();
    mock.restore();
  });

  describe("findOrCreateUser", () => {
    test("creates new user when email does not exist", async () => {
      const user = await findOrCreateUser("test@example.com");

      expect(user.email).toBe("test@example.com");
      expect(user.id).toBeDefined();
      expect(user.created_at).toBeDefined();
    });

    test("returns existing user when email already exists", async () => {
      // Create user first time
      const user1 = await findOrCreateUser("existing@example.com");

      // Try to create same user again
      const user2 = await findOrCreateUser("existing@example.com");

      expect(user1.id).toBe(user2.id);
      expect(user1.email).toBe(user2.email);
      expect(user1.created_at).toEqual(user2.created_at);
    });

    test("normalizes email case", async () => {
      const user1 = await findOrCreateUser("Test@Example.Com");
      const user2 = await findOrCreateUser("test@example.com");

      // Should be the same user since emails are case-insensitive
      expect(user1.id).toBe(user2.id);
    });
  });

  describe("createMagicLink", () => {
    test("creates magic link for existing user", async () => {
      const user = await findOrCreateUser("test@example.com");
      const { user: linkUser, rawToken } =
        await createMagicLink("test@example.com");

      expect(linkUser.id).toBe(user.id);
      expect(linkUser.email).toBe(user.email);
      expect(rawToken).toBeDefined();
      expect(typeof rawToken).toBe("string");
      expect(rawToken.length).toBeGreaterThan(20);
    });

    test("creates magic link for new user", async () => {
      const { user, rawToken } = await createMagicLink("new@example.com");

      expect(user.email).toBe("new@example.com");
      expect(user.id).toBeDefined();
      expect(rawToken).toBeDefined();
    });

    test("stores hashed token in database", async () => {
      const { user } = await createMagicLink("hash@example.com");

      // Verify token exists in database (hashed)
      const tokens = await db`
        SELECT id, user_id, type, expires_at, used_at
        FROM user_tokens 
        WHERE user_id = ${user.id} AND type = 'magic_link'
      `;

      expect(tokens).toHaveLength(1);
      expect((tokens[0] as any).user_id).toBe(user.id);
      expect((tokens[0] as any).type).toBe("magic_link");
      expect((tokens[0] as any).used_at).toBeNull();

      // Expiry should be about 15 minutes from now
      const expiresAt = new Date((tokens[0] as any).expires_at as string);
      const now = new Date();
      const diffMinutes = (expiresAt.getTime() - now.getTime()) / (1000 * 60);
      expect(diffMinutes).toBeGreaterThan(14);
      expect(diffMinutes).toBeLessThan(16);
    });
  });

  describe("verifyMagicLink", () => {
    test("successfully verifies valid unused token", async () => {
      const { user, rawToken } = await createMagicLink("verify@example.com");

      const result = await verifyMagicLink(rawToken);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.user.id).toBe(user.id);
        expect(result.user.email).toBe(user.email);
        expect(result.sessionId).toBeDefined();
      }
    });

    test("marks token as used after verification", async () => {
      const { user, rawToken } = await createMagicLink("used@example.com");

      await verifyMagicLink(rawToken);

      // Check that token is marked as used
      const tokens = await db`
        SELECT used_at FROM user_tokens 
        WHERE user_id = ${user.id} AND type = 'magic_link'
      `;

      expect(tokens).toHaveLength(1);
      expect((tokens[0] as any).used_at).not.toBeNull();
    });

    test("rejects already used token", async () => {
      const { rawToken } = await createMagicLink("reuse@example.com");

      // Use token once
      await verifyMagicLink(rawToken);

      // Try to use again
      const result = await verifyMagicLink(rawToken);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("Invalid or expired token");
      }
    });

    test("prevents race condition with simultaneous verification attempts", async () => {
      const { rawToken } = await createMagicLink("race@example.com");

      // Attempt to verify the same token simultaneously
      const [result1, result2] = await Promise.all([
        verifyMagicLink(rawToken),
        verifyMagicLink(rawToken),
      ]);

      // Only one should succeed due to atomic UPDATE
      const successes = [result1, result2].filter((r) => r.success);
      const failures = [result1, result2].filter((r) => !r.success);

      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);

      // The failure should be due to token already being used
      expect(failures[0].success).toBe(false);
      if (!failures[0].success) {
        expect(failures[0].error).toBe("Invalid or expired token");
      }
    });

    test("rejects invalid token", async () => {
      const result = await verifyMagicLink("invalid-token");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("Invalid or expired token");
      }
    });

    test("rejects expired token", async () => {
      const { user, rawToken } = await createMagicLink("expired@example.com");

      // Manually update token to be expired
      await db`
        UPDATE user_tokens 
        SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 hour'
        WHERE user_id = ${user.id} AND type = 'magic_link'
      `;

      const result = await verifyMagicLink(rawToken);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("Invalid or expired token");
      }
    });
  });

  describe("integration scenarios", () => {
    test("complete magic link auth flow", async () => {
      // Step 1: Create magic link
      const { user, rawToken } = await createMagicLink("complete@example.com");
      expect(user.email).toBe("complete@example.com");

      // Step 2: Verify magic link
      const authResult = await verifyMagicLink(rawToken);
      expect(authResult.success).toBe(true);

      if (!authResult.success) return;

      // Step 3: Use session
      const sessionData = await getSessionContextFromDB(authResult.sessionId);
      expect(sessionData?.user?.id).toBe(user.id);

      // Step 4: Logout
      const loggedOut = await deleteSession(authResult.sessionId);
      expect(loggedOut).toBe(true);

      // Step 5: Verify session is gone
      const noSession = await getSessionContextFromDB(authResult.sessionId);
      expect(noSession).toBeNull();
    });

    test("multiple users can have separate sessions", async () => {
      const { rawToken: token1 } = await createMagicLink("user1@example.com");
      const { rawToken: token2 } = await createMagicLink("user2@example.com");

      const auth1 = await verifyMagicLink(token1);
      const auth2 = await verifyMagicLink(token2);

      expect(auth1.success).toBe(true);
      expect(auth2.success).toBe(true);

      if (!auth1.success || !auth2.success) return;

      expect(auth1.sessionId).not.toBe(auth2.sessionId);
      expect(auth1.user.id).not.toBe(auth2.user.id);

      const session1 = await getSessionContextFromDB(auth1.sessionId);
      const session2 = await getSessionContextFromDB(auth2.sessionId);

      expect(session1?.user?.email).toBe("user1@example.com");
      expect(session2?.user?.email).toBe("user2@example.com");
    });
  });

  describe("findUserByEmail", () => {
    test("returns null instead of creating a user", async () => {
      expect(await findUserByEmail("nobody@example.com")).toBeNull();

      const rows =
        await db`SELECT id FROM users WHERE email = 'nobody@example.com'`;
      expect(rows).toHaveLength(0);
    });

    test("finds an existing user, normalizing case and whitespace", async () => {
      const created = await findOrCreateUser("Findme@Example.com");

      const found = await findUserByEmail("  FINDME@example.COM  ");
      expect(found?.id).toBe(created.id);
    });

    test("carries email_verified_at, null until the address is proven", async () => {
      const created = await findOrCreateUser("prove@example.com");
      expect(
        (await findUserByEmail("prove@example.com"))?.email_verified_at,
      ).toBeNull();

      await db`UPDATE users SET email_verified_at = NOW() WHERE id = ${created.id}`;

      const verified = await findUserByEmail("prove@example.com");
      expect(verified?.email_verified_at).toBeInstanceOf(Date);
    });
  });

  describe("createUserToken / consumeUserToken", () => {
    test("stores only the HMAC, never the raw token", async () => {
      const user = await findOrCreateUser("tokens@example.com");
      const rawToken = await createUserToken(user.id, "password_reset");

      const rows = await db`
        SELECT token_hash, type FROM user_tokens WHERE user_id = ${user.id}
      `;

      expect(rows).toHaveLength(1);
      expect(rows[0].type).toBe("password_reset");
      expect(rows[0].token_hash).not.toBe(rawToken);
    });

    test("returns the owning user id and marks the token used", async () => {
      const user = await findOrCreateUser("consume@example.com");
      const rawToken = await createUserToken(user.id, "email_verification");

      expect(await consumeUserToken(rawToken, "email_verification")).toBe(
        user.id,
      );

      const rows =
        await db`SELECT used_at FROM user_tokens WHERE user_id = ${user.id}`;
      expect(rows[0].used_at).not.toBeNull();
    });

    test("is single-use", async () => {
      const user = await findOrCreateUser("once@example.com");
      const rawToken = await createUserToken(user.id, "password_reset");

      expect(await consumeUserToken(rawToken, "password_reset")).toBe(user.id);
      expect(await consumeUserToken(rawToken, "password_reset")).toBeNull();
    });

    test("will not spend a token as the wrong type", async () => {
      const user = await findOrCreateUser("crosstype@example.com");
      const rawToken = await createUserToken(user.id, "email_verification");

      expect(await consumeUserToken(rawToken, "password_reset")).toBeNull();
      expect(await consumeUserToken(rawToken, "magic_link")).toBeNull();
      // Still spendable as its real type — the failed attempts didn't burn it.
      expect(await consumeUserToken(rawToken, "email_verification")).toBe(
        user.id,
      );
    });

    test("rejects an expired token", async () => {
      const user = await findOrCreateUser("stale@example.com");
      const rawToken = await createUserToken(user.id, "password_reset");
      await db`UPDATE user_tokens SET expires_at = NOW() - INTERVAL '1 minute' WHERE user_id = ${user.id}`;

      expect(await consumeUserToken(rawToken, "password_reset")).toBeNull();
    });

    test("gives each type its own lifetime", async () => {
      const user = await findOrCreateUser("ttl@example.com");
      await createUserToken(user.id, "magic_link");
      await createUserToken(user.id, "password_reset");
      await createUserToken(user.id, "email_verification");

      const rows = await db`
        SELECT type, expires_at FROM user_tokens WHERE user_id = ${user.id}
      `;
      const minutes = (type: string) => {
        const row = rows.find((r: { type: string }) => r.type === type);
        return (new Date(row.expires_at).getTime() - Date.now()) / 60000;
      };

      expect(minutes("magic_link")).toBeLessThan(16);
      expect(minutes("password_reset")).toBeGreaterThan(55);
      expect(minutes("password_reset")).toBeLessThan(65);
      expect(minutes("email_verification")).toBeGreaterThan(23 * 60);
    });

    test("consumes concurrently without double-spending", async () => {
      const user = await findOrCreateUser("tokenrace@example.com");
      const rawToken = await createUserToken(user.id, "password_reset");

      const results = await Promise.all([
        consumeUserToken(rawToken, "password_reset"),
        consumeUserToken(rawToken, "password_reset"),
      ]);

      expect(results.filter(Boolean)).toEqual([user.id]);
    });
  });

  describe("regenerateSession", () => {
    test("drops the guest session and issues a different one", async () => {
      const user = await findOrCreateUser("regen@example.com");
      const guestSessionId = await createGuestSession();

      const sessionId = await regenerateSession(user.id, guestSessionId);

      expect(sessionId).not.toBe(guestSessionId);
      expect(await getSessionContextFromDB(guestSessionId)).toBeNull();

      const ctx = await getSessionContextFromDB(sessionId);
      expect(ctx?.isAuthenticated).toBe(true);
      expect(ctx?.user?.id).toBe(user.id);
    });

    test("works with no guest session to discard", async () => {
      const user = await findOrCreateUser("regen-nogueest@example.com");

      const ctx = await getSessionContextFromDB(
        await regenerateSession(user.id),
      );
      expect(ctx?.isAuthenticated).toBe(true);
    });
  });

  describe("email verification via magic link", () => {
    test("stamps email_verified_at on first sign-in", async () => {
      const { user, rawToken } = await createMagicLink("verify@example.com");
      expect(user.email_verified_at).toBeNull();

      const result = await verifyMagicLink(rawToken);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.user.email_verified_at).toBeInstanceOf(Date);
      }
    });

    test("keeps the original timestamp on later sign-ins", async () => {
      const first = await createMagicLink("returning@example.com");
      const firstResult = await verifyMagicLink(first.rawToken);
      expect(firstResult.success).toBe(true);
      if (!firstResult.success) return;

      const second = await createMagicLink("returning@example.com");
      const secondResult = await verifyMagicLink(second.rawToken);

      expect(secondResult.success).toBe(true);
      if (secondResult.success) {
        expect(secondResult.user.email_verified_at).toEqual(
          firstResult.user.email_verified_at,
        );
      }
    });
  });

  describe("HMAC security", () => {
    test("database compromise cannot enable login", async () => {
      // Create user and magic link
      const { user, rawToken } = await createMagicLink("security@example.com");

      // Get the stored hash from database
      const tokens = await db`
        SELECT token_hash FROM user_tokens
        WHERE user_id = ${user.id} AND type = 'magic_link'
      `;

      expect(tokens).toHaveLength(1);
      const storedHash = (tokens[0] as any).token_hash;

      // Attempt to use the stored hash directly (should fail)
      const directHashResult = await verifyMagicLink(storedHash);
      expect(directHashResult.success).toBe(false);

      // Verify only the raw token with pepper works
      const validResult = await verifyMagicLink(rawToken);
      expect(validResult.success).toBe(true);
    });

    test("race condition with HMAC still works atomically", async () => {
      const { rawToken } = await createMagicLink("hmacrace@example.com");

      // Attempt to verify the same token simultaneously
      const [result1, result2] = await Promise.all([
        verifyMagicLink(rawToken),
        verifyMagicLink(rawToken),
      ]);

      // Only one should succeed due to atomic UPDATE
      const successes = [result1, result2].filter((r) => r.success);
      const failures = [result1, result2].filter((r) => !r.success);

      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);

      // The failure should be due to token already being used
      expect(failures[0].success).toBe(false);
      if (!failures[0].success) {
        expect(failures[0].error).toBe("Invalid or expired token");
      }
    });
  });

  describe("guest session upgrade", () => {
    test("deletes guest session and creates new session on login", async () => {
      const guestSessionId = await createGuestSession();

      const { user, rawToken } = await createMagicLink("upgrade@example.com");

      const result = await verifyMagicLink(rawToken, guestSessionId);

      expect(result.success).toBe(true);
      if (result.success) {
        // New session ID should be different (prevents session fixation)
        expect(result.sessionId).not.toBe(guestSessionId);
        expect(result.user.id).toBe(user.id);

        // Old guest session should be deleted
        const oldSession = await getSessionContextFromDB(guestSessionId);
        expect(oldSession).toBeNull();

        // New session should be authenticated
        const newSession = await getSessionContextFromDB(result.sessionId);
        expect(newSession?.isAuthenticated).toBe(true);
        expect(newSession?.user?.id).toBe(user.id);
      }
    });

    test("creates new session when no guestSessionId", async () => {
      // Create a magic link
      const { user, rawToken } = await createMagicLink("newuser@example.com");

      // Verify magic link without guest session
      const result = await verifyMagicLink(rawToken);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.sessionId).toBeDefined();
        expect(result.user.id).toBe(user.id);

        // Verify the session is authenticated
        const sessionContext = await getSessionContextFromDB(result.sessionId);
        expect(sessionContext?.isAuthenticated).toBe(true);
        expect(sessionContext?.user?.id).toBe(user.id);
      }
    });

    test("creates new session when guest upgrade fails", async () => {
      // Create a magic link
      const { user, rawToken } = await createMagicLink("fallback@example.com");

      // Try to verify with non-existent guest session
      const result = await verifyMagicLink(rawToken, "non-existent-session-id");

      expect(result.success).toBe(true);
      if (result.success) {
        // Should have created a new session (not the non-existent one)
        expect(result.sessionId).not.toBe("non-existent-session-id");
        expect(result.user.id).toBe(user.id);

        // Verify the new session is authenticated
        const sessionContext = await getSessionContextFromDB(result.sessionId);
        expect(sessionContext?.isAuthenticated).toBe(true);
        expect(sessionContext?.user?.id).toBe(user.id);
      }
    });
  });
});
