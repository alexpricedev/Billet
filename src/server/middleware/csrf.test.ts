import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { SQL } from "bun";
import { findOrCreateUser } from "../services/auth";
import { createCsrfToken } from "../services/csrf";
import { db } from "../services/database";
import { createAuthenticatedSession } from "../services/sessions";
import { createBunRequest } from "../test-utils/bun-request";
import { cleanupTestData } from "../test-utils/helpers";
import { csrfProtection } from "./csrf";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for tests");
}

const ORIGIN = new URL(process.env.APP_URL as string).origin;
const connection = new SQL(process.env.DATABASE_URL);

mock.module("../services/database", () => ({
  get db() {
    return connection;
  },
}));

describe("CSRF Middleware", () => {
  beforeEach(async () => {
    await cleanupTestData(db);
  });

  afterAll(async () => {
    await connection.end();
    mock.restore();
  });
  const createTestSession = async (
    email = `test-${Date.now()}-${Math.random()}@example.com`,
  ) => {
    const user = await findOrCreateUser(email);
    return createAuthenticatedSession(user.id);
  };

  describe("csrfProtection", () => {
    test("allows GET requests without token", async () => {
      const req = createBunRequest(`${ORIGIN}/test`, {
        method: "GET",
      });

      const response = await csrfProtection(req, {
        method: "GET",
        path: "/test",
      });

      expect(response).toBeNull();
    });

    test("allows HEAD requests without token", async () => {
      const req = createBunRequest(`${ORIGIN}/test`, {
        method: "HEAD",
      });

      const response = await csrfProtection(req, {
        method: "HEAD",
        path: "/test",
      });

      expect(response).toBeNull();
    });

    test("allows OPTIONS requests without token", async () => {
      const req = createBunRequest(`${ORIGIN}/test`, {
        method: "OPTIONS",
      });

      const response = await csrfProtection(req, {
        method: "OPTIONS",
        path: "/test",
      });

      expect(response).toBeNull();
    });

    test("rejects POST request without Origin/Referer", async () => {
      const sessionId = await createTestSession();
      const cookieHeader = `session_id=${sessionId}`;

      const req = createBunRequest(`${ORIGIN}/test`, {
        method: "POST",
        headers: {
          Cookie: cookieHeader,
        },
      });

      const response = await csrfProtection(req, {
        method: "POST",
        path: "/test",
      });

      expect(response).toBeTruthy();
      expect(response?.status).toBe(403);
      expect(await response?.text()).toBe("Invalid request origin");
    });

    test("rejects POST request without session cookie", async () => {
      const req = createBunRequest(`${ORIGIN}/test`, {
        method: "POST",
        headers: {
          Origin: ORIGIN,
        },
      });

      const response = await csrfProtection(req, {
        method: "POST",
        path: "/test",
      });

      expect(response).toBeTruthy();
      expect(response?.status).toBe(403);
      expect(await response?.text()).toBe("Invalid CSRF token");
    });

    test("rejects POST request without CSRF token", async () => {
      const sessionId = await createTestSession();
      const cookieHeader = `session_id=${sessionId}`;

      const req = createBunRequest(`${ORIGIN}/test`, {
        method: "POST",
        headers: {
          Origin: ORIGIN,
          Cookie: cookieHeader,
        },
      });

      const response = await csrfProtection(req, {
        method: "POST",
        path: "/test",
      });

      expect(response).toBeTruthy();
      expect(response?.status).toBe(403);
      expect(await response?.text()).toBe("Invalid CSRF token");
    });

    test("accepts POST request with valid CSRF token in header", async () => {
      const sessionId = await createTestSession();
      const cookieHeader = `session_id=${sessionId}`;
      const csrfToken = await createCsrfToken(sessionId, "POST", "/test");

      const req = createBunRequest(`${ORIGIN}/test`, {
        method: "POST",
        headers: {
          Origin: ORIGIN,
          Cookie: cookieHeader,
          "X-CSRF-Token": csrfToken,
        },
      });

      const response = await csrfProtection(req, {
        method: "POST",
        path: "/test",
      });

      expect(response).toBeNull();
    });

    test("accepts POST request with valid CSRF token in form data", async () => {
      const sessionId = await createTestSession();
      const cookieHeader = `session_id=${sessionId}`;
      const csrfToken = await createCsrfToken(sessionId, "POST", "/test");

      const formData = new FormData();
      formData.append("_csrf", csrfToken);
      formData.append("other", "data");

      const req = createBunRequest(`${ORIGIN}/test`, {
        method: "POST",
        headers: {
          Origin: ORIGIN,
          Cookie: cookieHeader,
        },
        body: formData,
      });

      const response = await csrfProtection(req, {
        method: "POST",
        path: "/test",
      });

      expect(response).toBeNull();
    });

    test("rejects POST request with invalid CSRF token", async () => {
      const sessionId = await createTestSession();
      const cookieHeader = `session_id=${sessionId}`;

      const req = createBunRequest(`${ORIGIN}/test`, {
        method: "POST",
        headers: {
          Origin: ORIGIN,
          Cookie: cookieHeader,
          "X-CSRF-Token": "invalid.token",
        },
      });

      const response = await csrfProtection(req, {
        method: "POST",
        path: "/test",
      });

      expect(response).toBeTruthy();
      expect(response?.status).toBe(403);
      expect(await response?.text()).toBe("Invalid CSRF token");
    });

    test("protects PUT requests", async () => {
      const req = createBunRequest(`${ORIGIN}/test`, {
        method: "PUT",
        headers: {
          Origin: ORIGIN,
        },
      });

      const response = await csrfProtection(req, {
        method: "PUT",
        path: "/test",
      });

      expect(response).toBeTruthy();
      expect(response?.status).toBe(403);
    });

    test("protects PATCH requests", async () => {
      const req = createBunRequest(`${ORIGIN}/test`, {
        method: "PATCH",
        headers: {
          Origin: ORIGIN,
        },
      });

      const response = await csrfProtection(req, {
        method: "PATCH",
        path: "/test",
      });

      expect(response).toBeTruthy();
      expect(response?.status).toBe(403);
    });

    test("protects DELETE requests", async () => {
      const req = createBunRequest(`${ORIGIN}/test`, {
        method: "DELETE",
        headers: {
          Origin: ORIGIN,
        },
      });

      const response = await csrfProtection(req, {
        method: "DELETE",
        path: "/test",
      });

      expect(response).toBeTruthy();
      expect(response?.status).toBe(403);
    });

    test("uses custom expected origin", async () => {
      const sessionId = await createTestSession();
      const cookieHeader = `session_id=${sessionId}`;
      const csrfToken = await createCsrfToken(sessionId, "POST", "/test");

      const req = createBunRequest(`${ORIGIN}/test`, {
        method: "POST",
        headers: {
          Origin: "http://custom.com",
          Cookie: cookieHeader,
          "X-CSRF-Token": csrfToken,
        },
      });

      const response = await csrfProtection(req, {
        method: "POST",
        path: "/test",
        expectedOrigin: "http://custom.com",
      });

      expect(response).toBeNull();
    });

    test("detects method mismatch - returns 500 for configuration error", async () => {
      const sessionId = await createTestSession();
      const cookieHeader = `session_id=${sessionId}`;

      const req = createBunRequest(`${ORIGIN}/test`, {
        method: "POST",
        headers: {
          Origin: ORIGIN,
          Cookie: cookieHeader,
        },
      });

      const response = await csrfProtection(req, {
        method: "PUT", // Wrong method passed in options
        path: "/test",
      });

      expect(response).toBeTruthy();
      expect(response?.status).toBe(500);
      expect(await response?.text()).toBe("Invalid request configuration");
    });

    test("works without method in options - uses req.method", async () => {
      const sessionId = await createTestSession();
      const cookieHeader = `session_id=${sessionId}`;
      const csrfToken = await createCsrfToken(sessionId, "POST", "/test");

      const req = createBunRequest(`${ORIGIN}/test`, {
        method: "POST",
        headers: {
          Origin: ORIGIN,
          Cookie: cookieHeader,
          "X-CSRF-Token": csrfToken,
        },
      });

      const response = await csrfProtection(req, {
        // No method specified - should use req.method
        path: "/test",
      });

      expect(response).toBeNull();
    });

    test("detects GET request method mismatch - returns 500 for configuration error", async () => {
      const req = createBunRequest(`${ORIGIN}/test`, {
        method: "GET",
        headers: {
          Origin: ORIGIN,
        },
      });

      const response = await csrfProtection(req, {
        method: "POST", // Wrong method - should return 500 for configuration error
        path: "/test",
      });

      expect(response).toBeTruthy();
      expect(response?.status).toBe(500);
      expect(await response?.text()).toBe("Invalid request configuration");
    });

    test("uses actual request method for token verification", async () => {
      const sessionId = await createTestSession();
      const cookieHeader = `session_id=${sessionId}`;

      // Create token with actual request method
      const csrfToken = await createCsrfToken(sessionId, "PATCH", "/test");

      const req = createBunRequest(`${ORIGIN}/test`, {
        method: "PATCH",
        headers: {
          Origin: ORIGIN,
          Cookie: cookieHeader,
          "X-CSRF-Token": csrfToken,
        },
      });

      const response = await csrfProtection(req, {
        method: "PATCH",
        path: "/test",
      });

      expect(response).toBeNull();
    });

    test("rejects token created for different method than actual request", async () => {
      const sessionId = await createTestSession();
      const cookieHeader = `session_id=${sessionId}`;

      // Create token for PUT but make POST request
      const csrfToken = await createCsrfToken(sessionId, "PUT", "/test");

      const req = createBunRequest(`${ORIGIN}/test`, {
        method: "POST", // Different method than token was created for
        headers: {
          Origin: ORIGIN,
          Cookie: cookieHeader,
          "X-CSRF-Token": csrfToken,
        },
      });

      const response = await csrfProtection(req, {
        method: "POST",
        path: "/test",
      });

      expect(response).toBeTruthy();
      expect(response?.status).toBe(403);
      expect(await response?.text()).toBe("Invalid CSRF token");
    });
  });
});
