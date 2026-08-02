import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  setSystemTime,
  test,
} from "bun:test";
import { SQL } from "bun";
import { findOrCreateUser } from "../services/auth";
import { createCsrfToken, TIME_WINDOW_MINUTES } from "../services/csrf";
import { db } from "../services/database";
import { createAuthenticatedSession } from "../services/sessions";
import { createBunRequest } from "../test-utils/bun-request";
import { cleanupTestData } from "../test-utils/helpers";
import { checkCsrf, csrfProtection, isRecoverableCsrfFailure } from "./csrf";

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

  afterEach(() => {
    setSystemTime();
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

  describe("checkCsrf", () => {
    const postRequest = (
      sessionId: string | null,
      token: string | null,
      origin: string | null = ORIGIN,
    ) => {
      const body = new FormData();
      body.append("title", "Something");
      if (token) {
        body.append("_csrf", token);
      }

      const headers: Record<string, string> = {};
      if (origin) {
        headers.Origin = origin;
      }
      if (sessionId) {
        headers.Cookie = `session_id=${sessionId}`;
      }

      return createBunRequest("http://localhost:3000/forms", {
        method: "POST",
        headers,
        body,
      });
    };

    const mintAged = async (
      sessionId: string,
      minutesAgo: number,
    ): Promise<string> => {
      setSystemTime(new Date(Date.now() - minutesAgo * 60 * 1000));
      const token = await createCsrfToken(sessionId, "POST", "/forms");
      setSystemTime();
      return token;
    };

    test("returns ok for a valid token", async () => {
      const sessionId = await createTestSession();
      const token = await createCsrfToken(sessionId, "POST", "/forms");

      const result = await checkCsrf(postRequest(sessionId, token), {
        method: "POST",
        path: "/forms",
      });

      expect(result.ok).toBe(true);
    });

    test("reports expired-token for a stale but authentic token", async () => {
      const sessionId = await createTestSession();
      const token = await mintAged(sessionId, TIME_WINDOW_MINUTES * 3);

      const result = await checkCsrf(postRequest(sessionId, token), {
        method: "POST",
        path: "/forms",
      });

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.reason).toBe("expired-token");
      expect(isRecoverableCsrfFailure(result)).toBe(true);
    });

    test("an origin failure is never recoverable", async () => {
      const sessionId = await createTestSession();
      const token = await createCsrfToken(sessionId, "POST", "/forms");

      const result = await checkCsrf(postRequest(sessionId, token, null), {
        method: "POST",
        path: "/forms",
      });

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.reason).toBe("invalid-origin");
      expect(isRecoverableCsrfFailure(result)).toBe(false);
      expect(result.ok === false && result.response.status).toBe(403);
    });

    test("a cross-origin request with a stale token is not recoverable", async () => {
      const sessionId = await createTestSession();
      const token = await mintAged(sessionId, TIME_WINDOW_MINUTES * 3);

      const result = await checkCsrf(
        postRequest(sessionId, token, "http://evil.example"),
        { method: "POST", path: "/forms" },
      );

      expect(result.ok === false && result.reason).toBe("invalid-origin");
      expect(isRecoverableCsrfFailure(result)).toBe(false);
    });

    test("reports missing-token and is not recoverable", async () => {
      const sessionId = await createTestSession();

      const result = await checkCsrf(postRequest(sessionId, null), {
        method: "POST",
        path: "/forms",
      });

      expect(result.ok === false && result.reason).toBe("missing-token");
      expect(isRecoverableCsrfFailure(result)).toBe(false);
    });

    test("reports invalid-token for a forged token", async () => {
      const sessionId = await createTestSession();
      await createCsrfToken(sessionId, "POST", "/forms");

      const result = await checkCsrf(postRequest(sessionId, "forged.token"), {
        method: "POST",
        path: "/forms",
      });

      expect(result.ok === false && result.reason).toBe("invalid-token");
      expect(isRecoverableCsrfFailure(result)).toBe(false);
    });

    test("reports expired-session and is not recoverable without a secret", async () => {
      const sessionId = await createTestSession();

      const result = await checkCsrf(postRequest(sessionId, "nonce.token"), {
        method: "POST",
        path: "/forms",
      });

      expect(result.ok === false && result.reason).toBe("expired-session");
      expect(isRecoverableCsrfFailure(result)).toBe(false);
    });

    test("reports missing-session when no cookie is present", async () => {
      const result = await checkCsrf(postRequest(null, "nonce.token"), {
        method: "POST",
        path: "/forms",
      });

      expect(result.ok === false && result.reason).toBe("missing-session");
      expect(isRecoverableCsrfFailure(result)).toBe(false);
    });
  });
});
