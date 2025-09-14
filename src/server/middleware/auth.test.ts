import { beforeEach, describe, expect, mock, test } from "bun:test";
import { SQL } from "bun";
import { cleanupTestData } from "../test-utils/helpers";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for tests");
}
const testDb = new SQL(process.env.DATABASE_URL);
mock.module("../services/database", () => ({
  db: testDb,
}));

import { createSession, findOrCreateUser } from "../services/auth";
import { getAuthContext, redirectIfAuthenticated, requireAuth } from "./auth";

const db = testDb;

describe("Auth Middleware", () => {
  beforeEach(async () => {
    await cleanupTestData(testDb);
  });

  describe("getAuthContext", () => {
    test("returns unauthenticated context for request without cookie", async () => {
      const request = new Request("http://localhost:3000/test");
      const context = await getAuthContext(request);

      expect(context.isAuthenticated).toBe(false);
      expect(context.user).toBeNull();
    });

    test("returns unauthenticated context for request with invalid session", async () => {
      const request = new Request("http://localhost:3000/test", {
        headers: {
          cookie: "session_id=invalid-session-id",
        },
      });
      const context = await getAuthContext(request);

      expect(context.isAuthenticated).toBe(false);
      expect(context.user).toBeNull();
    });

    test("returns unauthenticated context for expired session", async () => {
      const user = await findOrCreateUser("expired@example.com");

      // Create session using service, then manually expire it
      const sessionId = await createSession(user.id);

      // Import computeHMAC to get session hash for manual expiry
      const { computeHMAC } = await import("../utils/crypto");
      const sessionIdHash = computeHMAC(sessionId);

      // Expire the session
      await db`
        UPDATE sessions 
        SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 hour'
        WHERE id_hash = ${sessionIdHash}
      `;

      const request = new Request("http://localhost:3000/test", {
        headers: {
          cookie: `session_id=${sessionId}`,
        },
      });
      const context = await getAuthContext(request);

      expect(context.isAuthenticated).toBe(false);
      expect(context.user).toBeNull();
    });

    test("returns authenticated context for valid session", async () => {
      const user = await findOrCreateUser("valid@example.com");
      const sessionId = await createSession(user.id);

      const request = new Request("http://localhost:3000/test", {
        headers: {
          cookie: `session_id=${sessionId}`,
        },
      });
      const context = await getAuthContext(request);

      expect(context.isAuthenticated).toBe(true);
      expect(context.user).not.toBeNull();
      expect(context.user?.id).toBe(user.id);
      expect(context.user?.email).toBe(user.email);
    });

    test("handles multiple cookies correctly", async () => {
      const user = await findOrCreateUser("cookies@example.com");
      const sessionId = await createSession(user.id);

      const request = new Request("http://localhost:3000/test", {
        headers: {
          cookie: `other=value; session_id=${sessionId}; another=value`,
        },
      });
      const context = await getAuthContext(request);

      expect(context.isAuthenticated).toBe(true);
      expect(context.user?.id).toBe(user.id);
    });

    test("handles database errors gracefully", async () => {
      // Test with malformed session ID that will cause getSession to fail
      const request = new Request("http://localhost:3000/test", {
        headers: {
          cookie: "session_id=invalid-malformed-session-id-not-uuid",
        },
      });
      const context = await getAuthContext(request);

      expect(context.isAuthenticated).toBe(false);
      expect(context.user).toBeNull();
    });
  });

  describe("requireAuth", () => {
    test("returns null for authenticated user", async () => {
      const user = await findOrCreateUser("authed@example.com");
      const sessionId = await createSession(user.id);

      const request = new Request("http://localhost:3000/protected", {
        headers: {
          cookie: `session_id=${sessionId}`,
        },
      });

      const result = await requireAuth(request);
      expect(result).toBeNull();
    });

    test("returns redirect response for unauthenticated user", async () => {
      const request = new Request("http://localhost:3000/protected");

      const result = await requireAuth(request);

      expect(result).not.toBeNull();
      expect(result?.status).toBe(303);
      expect(result?.headers.get("location")).toBe("/login");
    });

    test("returns redirect for expired session", async () => {
      const user = await findOrCreateUser("expired2@example.com");

      // Create session using service, then manually expire it
      const sessionId = await createSession(user.id);

      // Import computeHMAC to get session hash for manual expiry
      const { computeHMAC } = await import("../utils/crypto");
      const sessionIdHash = computeHMAC(sessionId);

      // Expire the session
      await db`
        UPDATE sessions 
        SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 hour'
        WHERE id_hash = ${sessionIdHash}
      `;

      const request = new Request("http://localhost:3000/protected", {
        headers: {
          cookie: `session_id=${sessionId}`,
        },
      });

      const result = await requireAuth(request);

      expect(result).not.toBeNull();
      expect(result?.status).toBe(303);
      expect(result?.headers.get("location")).toBe("/login");
    });
  });

  describe("redirectIfAuthenticated", () => {
    test("returns redirect response for authenticated user", async () => {
      const user = await findOrCreateUser("authredirect@example.com");
      const sessionId = await createSession(user.id);

      const request = new Request("http://localhost:3000/login", {
        headers: {
          cookie: `session_id=${sessionId}`,
        },
      });

      const result = await redirectIfAuthenticated(request);

      expect(result).not.toBeNull();
      expect(result?.status).toBe(303);
      expect(result?.headers.get("location")).toBe("/");
    });

    test("returns null for unauthenticated user", async () => {
      const request = new Request("http://localhost:3000/login");

      const result = await redirectIfAuthenticated(request);
      expect(result).toBeNull();
    });

    test("returns null for expired session", async () => {
      const user = await findOrCreateUser("expiredredirect@example.com");

      // Create session using service, then manually expire it
      const sessionId = await createSession(user.id);

      // Import computeHMAC to get session hash for manual expiry
      const { computeHMAC } = await import("../utils/crypto");
      const sessionIdHash = computeHMAC(sessionId);

      // Expire the session
      await db`
        UPDATE sessions 
        SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 hour'
        WHERE id_hash = ${sessionIdHash}
      `;

      const request = new Request("http://localhost:3000/login", {
        headers: {
          cookie: `session_id=${sessionId}`,
        },
      });

      const result = await redirectIfAuthenticated(request);
      expect(result).toBeNull();
    });

    test("returns null for invalid session", async () => {
      const request = new Request("http://localhost:3000/login", {
        headers: {
          cookie: "session_id=invalid-session-id",
        },
      });

      const result = await redirectIfAuthenticated(request);
      expect(result).toBeNull();
    });
  });

  describe("integration scenarios", () => {
    test("complete auth flow with middleware", async () => {
      const email = "integration@example.com";

      // Step 1: Unauthenticated user trying to access protected resource
      let request = new Request("http://localhost:3000/protected");
      let authResult = await requireAuth(request);
      expect(authResult?.status).toBe(303);
      expect(authResult?.headers.get("location")).toBe("/login");

      // Step 2: User tries to access login page (should work)
      request = new Request("http://localhost:3000/login");
      let redirectResult = await redirectIfAuthenticated(request);
      expect(redirectResult).toBeNull();

      // Step 3: Create session (simulate successful login)
      const user = await findOrCreateUser(email);
      const sessionId = await createSession(user.id);

      // Step 4: Authenticated user can access protected resources
      request = new Request("http://localhost:3000/protected", {
        headers: { cookie: `session_id=${sessionId}` },
      });
      authResult = await requireAuth(request);
      expect(authResult).toBeNull(); // No redirect needed

      // Step 5: Authenticated user trying to access login page gets redirected
      request = new Request("http://localhost:3000/login", {
        headers: { cookie: `session_id=${sessionId}` },
      });
      redirectResult = await redirectIfAuthenticated(request);
      expect(redirectResult?.status).toBe(303);
      expect(redirectResult?.headers.get("location")).toBe("/");

      // Step 6: Auth context provides user info
      const context = await getAuthContext(request);
      expect(context.isAuthenticated).toBe(true);
      expect(context.user?.email).toBe(email);
    });
  });
});
