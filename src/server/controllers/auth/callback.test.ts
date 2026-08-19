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

import { createMagicLink } from "../../services/auth";
import { db } from "../../services/database";
import { createOrganizationForUser } from "../../services/organizations";
import { createBunRequest, findSetCookie } from "../../test-utils/bun-request";
import { callback } from "./callback";

describe("Callback Controller", () => {
  beforeEach(async () => {
    await cleanupTestData(db);
  });

  afterAll(async () => {
    await connection.end();
    mock.restore();
  });

  describe("GET /auth/callback", () => {
    test("successfully verifies valid magic link token", async () => {
      const { rawToken } = await createMagicLink("test@example.com");

      const request = createBunRequest(
        `http://localhost:3000/auth/callback?token=${rawToken}`,
        { method: "GET" },
      );

      const response = await callback.index(request);

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/");

      const setCookie = findSetCookie(request, "session_id");
      expect(setCookie).toContain("session_id=");
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("SameSite=Lax");
    });

    test("marks token as used after successful verification", async () => {
      const { user, rawToken } = await createMagicLink("used@example.com");

      await callback.index(
        createBunRequest(
          `http://localhost:3000/auth/callback?token=${rawToken}`,
        ),
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

      const request = createBunRequest(
        `http://localhost:3000/auth/callback?token=${rawToken}`,
      );

      await callback.index(request);

      const setCookie = findSetCookie(request, "session_id");
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
      const request = createBunRequest("http://localhost:3000/auth/callback", {
        method: "GET",
      });

      const response = await callback.index(request);

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(
        "/login?error=Missing authentication token",
      );
    });

    test("redirects with error for invalid token", async () => {
      const request = createBunRequest(
        "http://localhost:3000/auth/callback?token=invalid-token",
        { method: "GET" },
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
        createBunRequest(
          `http://localhost:3000/auth/callback?token=${rawToken}`,
        ),
      );

      const response = await callback.index(
        createBunRequest(
          `http://localhost:3000/auth/callback?token=${rawToken}`,
        ),
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
        createBunRequest(
          `http://localhost:3000/auth/callback?token=${rawToken}`,
        ),
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
        createBunRequest(
          `http://localhost:3000/auth/callback?token=${rawToken}`,
        ),
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

  // /team is in no navigation, so a signed-in user with no team has no link to
  // the create-a-team page. Landing them there is the only way they find it.
  describe("landing after sign-in with teams enabled", () => {
    const ORIGINAL_TEAMS = process.env.TEAMS_ENABLED;

    beforeEach(() => {
      process.env.TEAMS_ENABLED = "true";
    });

    afterAll(() => {
      if (ORIGINAL_TEAMS === undefined) delete process.env.TEAMS_ENABLED;
      else process.env.TEAMS_ENABLED = ORIGINAL_TEAMS;
    });

    const signIn = async (email: string) => {
      const { user, rawToken } = await createMagicLink(email);
      const response = await callback.index(
        createBunRequest(
          `http://localhost:3000/auth/callback?token=${rawToken}`,
        ),
      );

      return { user, location: response.headers.get("location") };
    };

    test("sends a user with no team to /team", async () => {
      const { location } = await signIn("teamless@example.com");

      expect(location).toBe("/team");
    });

    test("sends a user who is already in a team home", async () => {
      const first = await createMagicLink("member@example.com");
      const created = await createOrganizationForUser(first.user.id, "Acme");
      if (!created.success) throw new Error("seed failed");

      const { location } = await signIn("member@example.com");

      expect(location).toBe("/");
    });
  });
});

// The flag-off case is covered by every other test in this file: run-tests.ts
// pins TEAMS_ENABLED=false, and they all assert "/". That matters more than it
// looks — /team 404s with teams off, so a redirect there would break sign-in
// for every fork that never turned the feature on.
