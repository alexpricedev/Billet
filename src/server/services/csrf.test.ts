import { describe, expect, test } from "bun:test";
import { createSession, findOrCreateUser } from "./auth";
import {
  createCsrfToken,
  ensureCsrfSecret,
  validateOrigin,
  verifyCsrfToken,
} from "./csrf";

describe("CSRF Service", () => {
  const createTestSession = async () => {
    const user = await findOrCreateUser("test@example.com");
    return createSession(user.id);
  };

  describe("ensureCsrfSecret", () => {
    test("generates new secret for new session", async () => {
      const sessionId = await createTestSession();

      const secret = await ensureCsrfSecret(sessionId);

      expect(secret).toBeTruthy();
      expect(secret.length).toBeGreaterThan(20);
    });

    test("returns existing secret for session with secret", async () => {
      const sessionId = await createTestSession();

      const secret1 = await ensureCsrfSecret(sessionId);
      const secret2 = await ensureCsrfSecret(sessionId);

      expect(secret1).toBe(secret2);
    });

    test("returns empty string for non-existent session", async () => {
      const fakeSessionId = "non-existent-session";

      const secret = await ensureCsrfSecret(fakeSessionId);

      expect(secret).toBe("");
    });

    test("returns empty string when session exists but UPDATE fails", async () => {
      const sessionId = await createTestSession();

      // Delete the session to simulate a race condition
      const { computeHMAC } = await import("../utils/crypto");
      const sessionIdHash = computeHMAC(sessionId);
      await import("./database").then(
        ({ db }) => db`DELETE FROM sessions WHERE id_hash = ${sessionIdHash}`,
      );

      const secret = await ensureCsrfSecret(sessionId);

      expect(secret).toBe("");
    });

    test("handles concurrent secret generation race condition", async () => {
      const sessionId = await createTestSession();

      // Simulate concurrent calls to ensureCsrfSecret
      const promise1 = ensureCsrfSecret(sessionId);
      const promise2 = ensureCsrfSecret(sessionId);
      const promise3 = ensureCsrfSecret(sessionId);

      const [secret1, secret2, secret3] = await Promise.all([
        promise1,
        promise2,
        promise3,
      ]);

      // All should return the same secret (first writer wins)
      expect(secret1).toBeTruthy();
      expect(secret2).toBeTruthy();
      expect(secret3).toBeTruthy();
      expect(secret1).toBe(secret2);
      expect(secret2).toBe(secret3);

      // Verify the secret is actually stored in database
      const { computeHMAC } = await import("../utils/crypto");
      const sessionIdHash = computeHMAC(sessionId);
      const { db } = await import("./database");
      const dbResult = await db`
        SELECT csrf_secret FROM sessions WHERE id_hash = ${sessionIdHash}
      `;

      expect(dbResult.length).toBe(1);
      expect(dbResult[0].csrf_secret).toBe(secret1);
    });

    test("tokens from concurrent requests remain valid", async () => {
      const sessionId = await createTestSession();

      // Generate tokens concurrently (this will trigger concurrent ensureCsrfSecret calls)
      const tokenPromises = [
        createCsrfToken(sessionId, "POST", "/test1"),
        createCsrfToken(sessionId, "POST", "/test2"),
        createCsrfToken(sessionId, "POST", "/test3"),
      ];

      const [token1, token2, token3] = await Promise.all(tokenPromises);

      // All tokens should be valid
      expect(token1).toBeTruthy();
      expect(token2).toBeTruthy();
      expect(token3).toBeTruthy();

      // Verify all tokens are valid for their respective paths
      const [valid1, valid2, valid3] = await Promise.all([
        verifyCsrfToken(sessionId, "POST", "/test1", token1),
        verifyCsrfToken(sessionId, "POST", "/test2", token2),
        verifyCsrfToken(sessionId, "POST", "/test3", token3),
      ]);

      expect(valid1).toBe(true);
      expect(valid2).toBe(true);
      expect(valid3).toBe(true);
    });
  });

  describe("createCsrfToken and verifyCsrfToken", () => {
    test("creates and verifies valid token", async () => {
      const sessionId = await createTestSession();
      const method = "POST";
      const path = "/examples";

      const token = await createCsrfToken(sessionId, method, path);
      const isValid = await verifyCsrfToken(sessionId, method, path, token);

      expect(token).toBeTruthy();
      expect(token).toContain(".");
      expect(isValid).toBe(true);
    });

    test("rejects token with wrong method", async () => {
      const sessionId = await createTestSession();
      const method = "POST";
      const path = "/examples";

      const token = await createCsrfToken(sessionId, method, path);
      const isValid = await verifyCsrfToken(sessionId, "PUT", path, token);

      expect(isValid).toBe(false);
    });

    test("rejects token with wrong path", async () => {
      const sessionId = await createTestSession();
      const method = "POST";
      const path = "/examples";

      const token = await createCsrfToken(sessionId, method, path);
      const isValid = await verifyCsrfToken(sessionId, method, "/other", token);

      expect(isValid).toBe(false);
    });

    test("rejects token with wrong session", async () => {
      const sessionId1 = await createTestSession();
      const sessionId2 = await createTestSession();
      const method = "POST";
      const path = "/examples";

      const token = await createCsrfToken(sessionId1, method, path);
      const isValid = await verifyCsrfToken(sessionId2, method, path, token);

      expect(isValid).toBe(false);
    });

    test("rejects malformed token", async () => {
      const sessionId = await createTestSession();
      const method = "POST";
      const path = "/examples";

      const isValid1 = await verifyCsrfToken(
        sessionId,
        method,
        path,
        "invalid",
      );
      const isValid2 = await verifyCsrfToken(
        sessionId,
        method,
        path,
        "too.many.parts.here",
      );
      const isValid3 = await verifyCsrfToken(sessionId, method, path, "");

      expect(isValid1).toBe(false);
      expect(isValid2).toBe(false);
      expect(isValid3).toBe(false);
    });

    test("rejects token for non-existent session", async () => {
      const fakeSessionId = "non-existent-session";
      const method = "POST";
      const path = "/examples";

      const isValid = await verifyCsrfToken(
        fakeSessionId,
        method,
        path,
        "fake.token",
      );

      expect(isValid).toBe(false);
    });

    test("tokens are method case insensitive", async () => {
      const sessionId = await createTestSession();
      const path = "/examples";

      const token = await createCsrfToken(sessionId, "post", path);
      const isValid = await verifyCsrfToken(sessionId, "POST", path, token);

      expect(isValid).toBe(true);
    });

    test("path normalization - token valid for same path with query params", async () => {
      const sessionId = await createTestSession();
      const basePath = "/examples";
      const pathWithQuery = "/examples?x=1&y=2";

      // Create token for base path
      const token = await createCsrfToken(sessionId, "POST", basePath);

      // Should be valid for path with query params
      const isValid = await verifyCsrfToken(
        sessionId,
        "POST",
        pathWithQuery,
        token,
      );

      expect(isValid).toBe(true);
    });

    test("path normalization - token valid for same path with fragments", async () => {
      const sessionId = await createTestSession();
      const basePath = "/examples";
      const pathWithFragment = "/examples#section";

      // Create token for base path
      const token = await createCsrfToken(sessionId, "POST", basePath);

      // Should be valid for path with fragment
      const isValid = await verifyCsrfToken(
        sessionId,
        "POST",
        pathWithFragment,
        token,
      );

      expect(isValid).toBe(true);
    });

    test("createCsrfToken throws error for non-existent session", async () => {
      const fakeSessionId = "non-existent-session";

      await expect(
        createCsrfToken(fakeSessionId, "POST", "/test"),
      ).rejects.toThrow("Cannot create CSRF token: session not found");
    });
  });

  describe("validateOrigin", () => {
    test("accepts matching Origin header", () => {
      const req = new Request("http://example.com/test", {
        headers: { Origin: "http://example.com" },
      });

      const isValid = validateOrigin(req, "http://example.com");

      expect(isValid).toBe(true);
    });

    test("accepts matching Referer header when no Origin", () => {
      const req = new Request("http://example.com/test", {
        headers: { Referer: "http://example.com/page" },
      });

      const isValid = validateOrigin(req, "http://example.com");

      expect(isValid).toBe(true);
    });

    test("rejects mismatched Origin", () => {
      const req = new Request("http://example.com/test", {
        headers: { Origin: "http://evil.com" },
      });

      const isValid = validateOrigin(req, "http://example.com");

      expect(isValid).toBe(false);
    });

    test("rejects mismatched Referer", () => {
      const req = new Request("http://example.com/test", {
        headers: { Referer: "http://evil.com/page" },
      });

      const isValid = validateOrigin(req, "http://example.com");

      expect(isValid).toBe(false);
    });

    test("rejects request with no Origin or Referer", () => {
      const req = new Request("http://example.com/test");

      const isValid = validateOrigin(req, "http://example.com");

      expect(isValid).toBe(false);
    });

    test("uses request host as fallback when no expected origin provided", () => {
      const req = new Request("http://example.com/test", {
        headers: { Origin: "http://example.com" },
      });

      const isValid = validateOrigin(req);

      expect(isValid).toBe(true);
    });

    test("uses APP_ORIGIN env var as fallback", () => {
      const originalAppOrigin = process.env.APP_ORIGIN;
      process.env.APP_ORIGIN = "http://test.com";

      const req = new Request("http://example.com/test", {
        headers: { Origin: "http://test.com" },
      });

      const isValid = validateOrigin(req);

      expect(isValid).toBe(true);

      // Restore original env
      process.env.APP_ORIGIN = originalAppOrigin;
    });
  });
});
