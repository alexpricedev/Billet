import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { SQL } from "bun";
import { cleanupTestData } from "../../test-utils/helpers";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for tests");
}
const connection = new SQL(process.env.DATABASE_URL);

mock.module("../../services/database", () => ({
  get db() {
    return connection;
  },
}));

// Re-mock auth middleware with real implementation to prevent contamination
// from other test files (e.g. home.test.ts stubs getSessionContext globally).
// Must inline the logic because require() returns the already-mocked version.
mock.module("../../middleware/auth", () => {
  const {
    getSessionIdFromRequest,
    getSessionContextFromDB,
    createGuestSession,
    renewSession,
  } = require("../../services/sessions");

  const createGuestContext = async () => {
    const id = await createGuestSession();
    return {
      sessionId: id,
      sessionHash: null,
      sessionType: "guest",
      user: null,
      isGuest: true,
      isAuthenticated: false,
      requiresSetCookie: true,
    };
  };

  return {
    getSessionContext: async (req: import("bun").BunRequest) => {
      const sessionId = getSessionIdFromRequest(req);
      if (!sessionId) return createGuestContext();
      const ctx = await getSessionContextFromDB(sessionId);
      if (!ctx) return createGuestContext();
      if (ctx.isAuthenticated) await renewSession(sessionId);
      return ctx;
    },
  };
});

import { findOrCreateUser } from "../../services/auth";
import { createCsrfToken } from "../../services/csrf";
import { db } from "../../services/database";
import { createAuthenticatedSession } from "../../services/sessions";
import { createBunRequest, findSetCookie } from "../../test-utils/bun-request";
import { logout } from "./logout";

describe("Logout Controller", () => {
  beforeEach(async () => {
    await cleanupTestData(db);
  });

  afterAll(async () => {
    await connection.end();
    mock.restore();
  });

  describe("POST /auth/logout", () => {
    test("successfully logs out user with valid session", async () => {
      const user = await findOrCreateUser("logout@example.com");
      const sessionId = await createAuthenticatedSession(user.id);
      const csrfToken = await createCsrfToken(
        sessionId,
        "POST",
        "/auth/logout",
      );

      const formData = new FormData();
      formData.append("_csrf", csrfToken);

      const request = createBunRequest("http://localhost:3000/auth/logout", {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
          Cookie: `session_id=${sessionId}`,
        },
        body: formData,
      });

      const response = await logout.create(request);

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/login");

      const setCookie = findSetCookie(request, "session_id");
      expect(setCookie).toBeTruthy();
      expect(setCookie).toContain("session_id=");
      expect(setCookie).toContain("Max-Age=0");

      const { computeHMAC } = await import("../../utils/crypto");
      const sessionIdHash = computeHMAC(sessionId);
      const sessions = await db`
        SELECT id_hash FROM sessions WHERE id_hash = ${sessionIdHash}
      `;
      expect(sessions).toHaveLength(0);
    });

    test("handles logout without session cookie gracefully", async () => {
      const request = createBunRequest("http://localhost:3000/auth/logout", {
        method: "POST",
      });

      const response = await logout.create(request);

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/login");

      const setCookie = findSetCookie(request, "session_id");
      expect(setCookie).toBeTruthy();
      expect(setCookie).toContain("session_id=");
      expect(setCookie).toContain("Max-Age=0");
    });

    test("handles logout with invalid session ID gracefully", async () => {
      const request = createBunRequest("http://localhost:3000/auth/logout", {
        method: "POST",
        headers: {
          cookie: "session_id=invalid-session-id",
        },
      });

      const response = await logout.create(request);

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/login");

      const setCookie = findSetCookie(request, "session_id");
      expect(setCookie).toBeTruthy();
      expect(setCookie).toContain("Max-Age=0");
    });

    test("handles logout with malformed cookie header gracefully", async () => {
      const request = createBunRequest("http://localhost:3000/auth/logout", {
        method: "POST",
        headers: {
          cookie: "malformed-cookie-data",
        },
      });

      const response = await logout.create(request);

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/login");
    });

    test("multiple session cookies - uses correct session_id", async () => {
      const user = await findOrCreateUser("multi@example.com");
      const sessionId = await createAuthenticatedSession(user.id);
      const csrfToken = await createCsrfToken(
        sessionId,
        "POST",
        "/auth/logout",
      );

      const formData = new FormData();
      formData.append("_csrf", csrfToken);

      const request = createBunRequest("http://localhost:3000/auth/logout", {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
          cookie: `other_cookie=value; session_id=${sessionId}; another=value`,
        },
        body: formData,
      });

      const response = await logout.create(request);

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/login");

      // Correct session should be deleted
      const { computeHMAC } = await import("../../utils/crypto");
      const sessionIdHash = computeHMAC(sessionId);
      const sessions = await db`
        SELECT id_hash FROM sessions WHERE id_hash = ${sessionIdHash}
      `;
      expect(sessions).toHaveLength(0);
    });

    test("handles database error during session deletion gracefully", async () => {
      // Create session then delete the user to cause foreign key issues
      const user = await findOrCreateUser("dbError@example.com");
      const sessionId = await createAuthenticatedSession(user.id);

      // Delete user (this will cascade delete the session in real DB, but might cause errors in test)
      await db`DELETE FROM users WHERE id = ${user.id}`;

      const request = createBunRequest("http://localhost:3000/auth/logout", {
        method: "POST",
        headers: {
          cookie: `session_id=${sessionId}`,
        },
      });

      const response = await logout.create(request);

      // Should still redirect and clear cookie even if DB error occurs
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/login");

      const setCookie = findSetCookie(request, "session_id");
      expect(setCookie).toBeTruthy();
      expect(setCookie).toContain("Max-Age=0");
    });

    test("requires authentication - redirects unauthenticated users", async () => {
      const request = createBunRequest("http://localhost:3000/auth/logout", {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
        },
      });

      const response = await logout.create(request);

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/login");
    });

    test("requires CSRF token - rejects request without token", async () => {
      const user = await findOrCreateUser("csrf-test@example.com");
      const sessionId = await createAuthenticatedSession(user.id);
      const cookieHeader = `session_id=${sessionId}`;

      const request = createBunRequest("http://localhost:3000/auth/logout", {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
          Cookie: cookieHeader,
        },
      });

      const response = await logout.create(request);

      expect(response.status).toBe(403);
      expect(await response.text()).toBe("Invalid CSRF token");
    });

    test("requires CSRF token - rejects request with invalid token", async () => {
      const user = await findOrCreateUser("csrf-test2@example.com");
      const sessionId = await createAuthenticatedSession(user.id);
      const cookieHeader = `session_id=${sessionId}`;

      const formData = new FormData();
      formData.append("_csrf", "invalid.token");

      const request = createBunRequest("http://localhost:3000/auth/logout", {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
          Cookie: cookieHeader,
        },
        body: formData,
      });

      const response = await logout.create(request);

      expect(response.status).toBe(403);
      expect(await response.text()).toBe("Invalid CSRF token");
    });

    test("accepts request with valid CSRF token", async () => {
      const user = await findOrCreateUser("csrf-test3@example.com");
      const sessionId = await createAuthenticatedSession(user.id);
      const cookieHeader = `session_id=${sessionId}`;
      const csrfToken = await createCsrfToken(
        sessionId,
        "POST",
        "/auth/logout",
      );

      const formData = new FormData();
      formData.append("_csrf", csrfToken);

      const request = createBunRequest("http://localhost:3000/auth/logout", {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
          Cookie: cookieHeader,
        },
        body: formData,
      });

      const response = await logout.create(request);

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/login");

      const setCookie = findSetCookie(request, "session_id");
      expect(setCookie).toBeTruthy();
      expect(setCookie).toContain("session_id=");
      expect(setCookie).toContain("Max-Age=0");
    });
  });
});
