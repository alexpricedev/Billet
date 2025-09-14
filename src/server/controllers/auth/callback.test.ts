import { beforeEach, describe, expect, mock, test } from "bun:test";
import { SQL } from "bun";
import { cleanupTestData } from "../../test-utils/helpers";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for tests");
}
const testDb = new SQL(process.env.DATABASE_URL);
mock.module("../../services/database", () => ({
  db: testDb,
}));

import { createMagicLink } from "../../services/auth";
import { callback } from "./callback";

const db = testDb;

describe("Callback Controller", () => {
  beforeEach(async () => {
    await cleanupTestData(testDb);
  });

  describe("GET /auth/callback", () => {
    test("successfully verifies valid magic link token", async () => {
      const { rawToken } = await createMagicLink("test@example.com");

      const request = new Request(
        `http://localhost:3000/auth/callback?token=${rawToken}`,
        {
          method: "GET",
        },
      );

      const response = await callback.index(request);

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/");

      const setCookie = response.headers.get("set-cookie");
      expect(setCookie).toContain("session_id=");
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("SameSite=Lax");
    });

    test("marks token as used after successful verification", async () => {
      const { user, rawToken } = await createMagicLink("used@example.com");

      await callback.index(
        new Request(`http://localhost:3000/auth/callback?token=${rawToken}`),
      );

      const tokens = await db`
        SELECT used_at FROM user_tokens 
        WHERE user_id = ${user.id} AND type = 'magic_link'
      `;

      expect(tokens).toHaveLength(1);
      expect((tokens[0] as any).used_at).not.toBeNull();
    });

    test("creates valid session after token verification", async () => {
      const { user, rawToken } = await createMagicLink("session@example.com");

      const response = await callback.index(
        new Request(`http://localhost:3000/auth/callback?token=${rawToken}`),
      );

      const setCookie = response.headers.get("set-cookie");
      const sessionMatch = setCookie?.match(/session_id=([^;]+)/);
      const sessionId = sessionMatch?.[1];

      expect(sessionId).toBeDefined();
      if (!sessionId) {
        throw new Error("Session ID should be defined at this point");
      }

      const { computeHMAC } = await import("../../utils/crypto");
      const sessionIdHash = computeHMAC(sessionId);
      const sessions = await db`
        SELECT user_id, expires_at FROM sessions WHERE id_hash = ${sessionIdHash}
      `;

      expect(sessions).toHaveLength(1);
      expect((sessions[0] as any).user_id).toBe(user.id);

      const expiresAt = new Date((sessions[0] as any).expires_at as string);
      const now = new Date();
      const diffDays =
        (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeGreaterThan(29);
      expect(diffDays).toBeLessThan(31);
    });

    test("redirects with error for missing token", async () => {
      const request = new Request("http://localhost:3000/auth/callback", {
        method: "GET",
      });

      const response = await callback.index(request);

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(
        "/login?error=Missing authentication token",
      );
    });

    test("redirects with error for invalid token", async () => {
      const request = new Request(
        "http://localhost:3000/auth/callback?token=invalid-token",
        {
          method: "GET",
        },
      );

      const response = await callback.index(request);

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toContain("/login?error=");
      const location = response.headers.get("location");
      expect(location).toBeTruthy();
      expect(decodeURIComponent(location as string)).toContain(
        "Invalid or expired token",
      );
    });

    test("redirects with error for already used token", async () => {
      const { rawToken } = await createMagicLink("reuse@example.com");

      await callback.index(
        new Request(`http://localhost:3000/auth/callback?token=${rawToken}`),
      );

      const response = await callback.index(
        new Request(`http://localhost:3000/auth/callback?token=${rawToken}`),
      );

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toContain("/login?error=");
      const location2 = response.headers.get("location");
      expect(location2).toBeTruthy();
      expect(decodeURIComponent(location2 as string)).toContain(
        "Invalid or expired token",
      );
    });

    test("redirects with error for expired token", async () => {
      const { user, rawToken } = await createMagicLink("expired@example.com");

      await db`
        UPDATE user_tokens 
        SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 hour'
        WHERE user_id = ${user.id} AND type = 'magic_link'
      `;

      const response = await callback.index(
        new Request(`http://localhost:3000/auth/callback?token=${rawToken}`),
      );

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toContain("/login?error=");
      const location3 = response.headers.get("location");
      expect(location3).toBeTruthy();
      expect(decodeURIComponent(location3 as string)).toContain("expired");
    });

    test("handles database errors gracefully", async () => {
      const { user, rawToken } = await createMagicLink("deleted@example.com");

      await db`DELETE FROM users WHERE id = ${user.id}`;

      const response = await callback.index(
        new Request(`http://localhost:3000/auth/callback?token=${rawToken}`),
      );

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toContain("/login?error=");
      const location4 = response.headers.get("location");
      expect(location4).toBeTruthy();
      expect(decodeURIComponent(location4 as string)).toContain(
        "Invalid or expired token",
      );
    });
  });
});
