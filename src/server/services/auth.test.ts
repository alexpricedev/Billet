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

import { createMagicLink, findOrCreateUser, verifyMagicLink } from "./auth";
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
