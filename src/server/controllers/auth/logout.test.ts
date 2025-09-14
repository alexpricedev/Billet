import { beforeEach, describe, expect, test } from "bun:test";
import { createSession, findOrCreateUser } from "../../services/auth";
import { db } from "../../services/database";
import { cleanupTestData } from "../../test-utils/test-database";
import { logout } from "./logout";

describe("Logout Controller", () => {
  beforeEach(async () => {
    await cleanupTestData();
  });

  describe("POST /auth/logout", () => {
    test("successfully logs out user with valid session", async () => {
      const user = await findOrCreateUser("logout@example.com");
      const sessionId = await createSession(user.id);

      const request = new Request("http://localhost:3000/auth/logout", {
        method: "POST",
        headers: {
          cookie: `session_id=${sessionId}`,
        },
      });

      const response = await logout.create(request);

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/login");

      // Should clear session cookie
      const setCookie = response.headers.get("set-cookie");
      expect(setCookie).toContain("session_id=");
      expect(setCookie).toContain("Max-Age=0");

      // Session should be deleted from database
      const { computeHMAC } = await import("../../utils/crypto");
      const sessionIdHash = computeHMAC(sessionId);
      const sessions = await db`
        SELECT id_hash FROM sessions WHERE id_hash = ${sessionIdHash}
      `;
      expect(sessions).toHaveLength(0);
    });

    test("handles logout without session cookie gracefully", async () => {
      const request = new Request("http://localhost:3000/auth/logout", {
        method: "POST",
      });

      const response = await logout.create(request);

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/login");

      // Should still clear cookie
      const setCookie = response.headers.get("set-cookie");
      expect(setCookie).toContain("session_id=");
      expect(setCookie).toContain("Max-Age=0");
    });

    test("handles logout with invalid session ID gracefully", async () => {
      const request = new Request("http://localhost:3000/auth/logout", {
        method: "POST",
        headers: {
          cookie: "session_id=invalid-session-id",
        },
      });

      const response = await logout.create(request);

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/login");

      // Should clear cookie even if session doesn't exist
      const setCookie = response.headers.get("set-cookie");
      expect(setCookie).toContain("Max-Age=0");
    });

    test("handles logout with malformed cookie header gracefully", async () => {
      const request = new Request("http://localhost:3000/auth/logout", {
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
      const sessionId = await createSession(user.id);

      const request = new Request("http://localhost:3000/auth/logout", {
        method: "POST",
        headers: {
          cookie: `other_cookie=value; session_id=${sessionId}; another=value`,
        },
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
      const sessionId = await createSession(user.id);

      // Delete user (this will cascade delete the session in real DB, but might cause errors in test)
      await db`DELETE FROM users WHERE id = ${user.id}`;

      const request = new Request("http://localhost:3000/auth/logout", {
        method: "POST",
        headers: {
          cookie: `session_id=${sessionId}`,
        },
      });

      const response = await logout.create(request);

      // Should still redirect and clear cookie even if DB error occurs
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/login");

      const setCookie = response.headers.get("set-cookie");
      expect(setCookie).toContain("Max-Age=0");
    });
  });
});
