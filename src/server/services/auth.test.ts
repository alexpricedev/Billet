import { beforeEach, describe, expect, mock, test } from "bun:test";
import { SQL } from "bun";
import { cleanupTestData } from "../test-utils/helpers";
import { computeHMAC } from "../utils/crypto";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for tests");
}
const testDb = new SQL(process.env.DATABASE_URL);
mock.module("./database", () => ({
  db: testDb,
}));

import {
  clearSessionCookie,
  createMagicLink,
  createSession,
  createSessionCookie,
  deleteSession,
  findOrCreateUser,
  getSession,
  getSessionIdFromCookies,
  renewSession,
  verifyMagicLink,
} from "./auth";

const db = testDb;

describe("Auth Service with PostgreSQL", () => {
  beforeEach(async () => {
    await cleanupTestData(testDb);
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

  describe("createSession", () => {
    test("creates session with UUID and expiry", async () => {
      const user = await findOrCreateUser("session@example.com");
      const sessionId = await createSession(user.id);

      expect(sessionId).toBeDefined();
      expect(typeof sessionId).toBe("string");

      // Verify session exists in database by hash
      const sessionIdHash = computeHMAC(sessionId);
      const sessions = await db`
        SELECT id_hash, user_id, expires_at, created_at
        FROM sessions
        WHERE id_hash = ${sessionIdHash}
      `;

      expect(sessions).toHaveLength(1);
      expect((sessions[0] as any).user_id).toBe(user.id);

      // Expiry should be about 30 days from now
      const expiresAt = new Date((sessions[0] as any).expires_at as string);
      const now = new Date();
      const diffDays =
        (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeGreaterThan(29);
      expect(diffDays).toBeLessThan(31);
    });
  });

  describe("getSession", () => {
    test("returns session and user data for valid session", async () => {
      const user = await findOrCreateUser("getsession@example.com");
      const sessionId = await createSession(user.id);

      const result = await getSession(sessionId);

      expect(result).not.toBeNull();
      expect(result?.user.id).toBe(user.id);
      expect(result?.user.email).toBe(user.email);
      expect(result?.session.id_hash).toBe(computeHMAC(sessionId));
      expect(result?.session.user_id).toBe(user.id);
    });

    test("returns null for non-existent session", async () => {
      const result = await getSession("non-existent-session-id");
      expect(result).toBeNull();
    });

    test("returns null for expired session", async () => {
      const user = await findOrCreateUser("expiredsession@example.com");
      const sessionId = await createSession(user.id);

      // Manually expire the session
      const sessionIdHash = computeHMAC(sessionId);
      await db`
        UPDATE sessions 
        SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 hour'
        WHERE id_hash = ${sessionIdHash}
      `;

      const result = await getSession(sessionId);
      expect(result).toBeNull();
    });
  });

  describe("deleteSession", () => {
    test("successfully deletes existing session", async () => {
      const user = await findOrCreateUser("deletesession@example.com");
      const sessionId = await createSession(user.id);

      const deleted = await deleteSession(sessionId);
      expect(deleted).toBe(true);

      // Verify session is gone
      const result = await getSession(sessionId);
      expect(result).toBeNull();
    });

    test("returns false for non-existent session", async () => {
      // Test what PostgreSQL returns for a DELETE with no matches
      const _testResult = await db`
        DELETE FROM sessions WHERE id_hash = 'non-existent-hash'
      `;

      // Now test our function
      const deleted = await deleteSession(
        "00000000-0000-0000-0000-000000000000",
      );
      expect(deleted).toBe(false);
    });
  });

  describe("cookie utilities", () => {
    test("createSessionCookie generates proper cookie string", () => {
      const cookie = createSessionCookie("test-session-id");

      expect(cookie).toContain("session_id=test-session-id");
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("Path=/");
      expect(cookie).toContain("Max-Age=2592000"); // 30 days
      expect(cookie).toContain("SameSite=Lax");
    });

    test("clearSessionCookie generates cookie clear string", () => {
      const cookie = clearSessionCookie();

      expect(cookie).toContain("session_id=");
      expect(cookie).toContain("Max-Age=0");
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("Path=/");
    });

    test("getSessionIdFromCookies extracts session ID", () => {
      const cookies = "other=value; session_id=test-session; another=value";
      const sessionId = getSessionIdFromCookies(cookies);

      expect(sessionId).toBe("test-session");
    });

    test("getSessionIdFromCookies returns null for missing cookie", () => {
      const cookies = "other=value; another=value";
      const sessionId = getSessionIdFromCookies(cookies);

      expect(sessionId).toBeNull();
    });

    test("getSessionIdFromCookies returns null for null header", () => {
      const sessionId = getSessionIdFromCookies(null);
      expect(sessionId).toBeNull();
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
      const sessionData = await getSession(authResult.sessionId);
      expect(sessionData?.user.id).toBe(user.id);

      // Step 4: Logout
      const loggedOut = await deleteSession(authResult.sessionId);
      expect(loggedOut).toBe(true);

      // Step 5: Verify session is gone
      const noSession = await getSession(authResult.sessionId);
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

      const session1 = await getSession(auth1.sessionId);
      const session2 = await getSession(auth2.sessionId);

      expect(session1?.user.email).toBe("user1@example.com");
      expect(session2?.user.email).toBe("user2@example.com");
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

    test("session renewal extends activity timestamp", async () => {
      const user = await findOrCreateUser("renewal@example.com");
      const sessionId = await createSession(user.id);

      // Get initial activity timestamp
      const sessionHash = computeHMAC(sessionId);
      const initialSessions = await db`
        SELECT last_activity_at FROM sessions 
        WHERE id_hash = ${sessionHash}
      `;

      expect(initialSessions).toHaveLength(1);
      const initialActivity = new Date(
        (initialSessions[0] as any).last_activity_at,
      );

      // Wait a small amount to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Renew session
      const renewed = await renewSession(sessionId);
      expect(renewed).toBe(true);

      // Verify activity timestamp was updated
      const updatedSessions = await db`
        SELECT last_activity_at FROM sessions 
        WHERE id_hash = ${sessionHash}
      `;

      expect(updatedSessions).toHaveLength(1);
      const updatedActivity = new Date(
        (updatedSessions[0] as any).last_activity_at,
      );

      expect(updatedActivity.getTime()).toBeGreaterThan(
        initialActivity.getTime(),
      );
    });

    test("session lookup uses HMAC not raw ID", async () => {
      const user = await findOrCreateUser("hmac@example.com");
      const rawSessionId = await createSession(user.id);

      // Verify raw session ID cannot be found directly in database
      const rawLookup = await db`
        SELECT * FROM sessions WHERE id_hash = ${rawSessionId}
      `;
      expect(rawLookup).toHaveLength(0);

      // Verify HMAC lookup works
      const hmacHash = computeHMAC(rawSessionId);
      const hmacLookup = await db`
        SELECT * FROM sessions WHERE id_hash = ${hmacHash}
      `;
      expect(hmacLookup).toHaveLength(1);

      // Verify getSession works with raw ID (computes HMAC internally)
      const sessionData = await getSession(rawSessionId);
      expect(sessionData).not.toBeNull();
      expect(sessionData?.user.id).toBe(user.id);
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
});
