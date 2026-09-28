import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { testDatabase } from "../test-utils/database";
import { cleanupTestData } from "../test-utils/helpers";

const connection = testDatabase();

mock.module("../services/database", () => ({
  get db() {
    return connection;
  },
}));

import { findOrCreateUser } from "../services/auth";
import { db } from "../services/database";
import {
  createAuthenticatedSession,
  createGuestSession,
} from "../services/sessions";
import { createBunRequest } from "../test-utils/bun-request";
import { getSessionContext, guestPageContext, requireAuth } from "./auth";

describe("Auth Middleware", () => {
  beforeEach(async () => {
    await cleanupTestData(db);
  });

  afterAll(async () => {
    await connection.end();
    mock.restore();
  });

  describe("getSessionContext", () => {
    test("returns guest context with requiresSetCookie for request without cookie", async () => {
      const request = createBunRequest("http://localhost:3000/test");
      const context = await getSessionContext(request);

      expect(context.isAuthenticated).toBe(false);
      expect(context.isGuest).toBe(true);
      expect(context.requiresSetCookie).toBe(true);
      expect(context.user).toBeNull();
      expect(context.sessionId).not.toBeNull();
      expect(context.sessionType).toBe("guest");
    });

    test("returns guest context with requiresSetCookie false for valid guest session", async () => {
      const sessionId = await createGuestSession();

      const request = createBunRequest("http://localhost:3000/test", {
        headers: { cookie: `session_id=${sessionId}` },
      });
      const context = await getSessionContext(request);

      expect(context.isAuthenticated).toBe(false);
      expect(context.isGuest).toBe(true);
      expect(context.requiresSetCookie).toBe(false);
      expect(context.user).toBeNull();
      expect(context.sessionId).toBe(sessionId);
      expect(context.sessionType).toBe("guest");
    });

    test("returns authenticated context with user data for valid authenticated session", async () => {
      const user = await findOrCreateUser("valid@example.com");
      const sessionId = await createAuthenticatedSession(user.id);

      const request = createBunRequest("http://localhost:3000/test", {
        headers: { cookie: `session_id=${sessionId}` },
      });
      const context = await getSessionContext(request);

      expect(context.isAuthenticated).toBe(true);
      expect(context.isGuest).toBe(false);
      expect(context.requiresSetCookie).toBe(false);
      expect(context.user).not.toBeNull();
      expect(context.user?.id).toBe(user.id);
      expect(context.user?.email).toBe(user.email);
      expect(context.sessionId).toBe(sessionId);
      expect(context.sessionType).toBe("authenticated");
    });

    test("returns guest context with requiresSetCookie for invalid session cookie", async () => {
      const request = createBunRequest("http://localhost:3000/test", {
        headers: { cookie: "session_id=invalid-session-id" },
      });
      const context = await getSessionContext(request);

      expect(context.isAuthenticated).toBe(false);
      expect(context.isGuest).toBe(true);
      expect(context.requiresSetCookie).toBe(true);
      expect(context.user).toBeNull();
    });

    test("returns guest context with requiresSetCookie for expired session", async () => {
      const user = await findOrCreateUser("expired@example.com");
      const sessionId = await createAuthenticatedSession(user.id);

      const { computeHMAC } = await import("../utils/crypto");
      const sessionIdHash = computeHMAC(sessionId);

      await db`
        UPDATE sessions
        SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 hour'
        WHERE id_hash = ${sessionIdHash}
      `;

      const request = createBunRequest("http://localhost:3000/test", {
        headers: { cookie: `session_id=${sessionId}` },
      });
      const context = await getSessionContext(request);

      expect(context.isAuthenticated).toBe(false);
      expect(context.isGuest).toBe(true);
      expect(context.requiresSetCookie).toBe(true);
      expect(context.user).toBeNull();
    });

    test("handles database errors gracefully", async () => {
      const request = createBunRequest("http://localhost:3000/test", {
        headers: { cookie: "session_id=malformed-not-uuid" },
      });
      const context = await getSessionContext(request);

      expect(context.isAuthenticated).toBe(false);
      expect(context.isGuest).toBe(true);
      expect(context.requiresSetCookie).toBe(true);
      expect(context.user).toBeNull();
    });

    test("handles multiple cookies correctly", async () => {
      const user = await findOrCreateUser("cookies@example.com");
      const sessionId = await createAuthenticatedSession(user.id);

      const request = createBunRequest("http://localhost:3000/test", {
        headers: {
          cookie: `other=value; session_id=${sessionId}; another=value`,
        },
      });
      const context = await getSessionContext(request);

      expect(context.isAuthenticated).toBe(true);
      expect(context.user?.id).toBe(user.id);
    });
  });

  describe("requireAuth", () => {
    test("returns null for authenticated user", async () => {
      const user = await findOrCreateUser("authed@example.com");
      const sessionId = await createAuthenticatedSession(user.id);

      const request = createBunRequest("http://localhost:3000/protected", {
        headers: { cookie: `session_id=${sessionId}` },
      });

      const result = await requireAuth(request);
      expect(result).toBeNull();
    });

    test("returns redirect response for unauthenticated user", async () => {
      const request = createBunRequest("http://localhost:3000/protected");

      const result = await requireAuth(request);

      expect(result).not.toBeNull();
      expect(result?.status).toBe(303);
      expect(result?.headers.get("location")).toBe("/login");
    });

    test("returns redirect for guest session", async () => {
      const sessionId = await createGuestSession();

      const request = createBunRequest("http://localhost:3000/protected", {
        headers: { cookie: `session_id=${sessionId}` },
      });

      const result = await requireAuth(request);

      expect(result).not.toBeNull();
      expect(result?.status).toBe(303);
      expect(result?.headers.get("location")).toBe("/login");
    });

    test("returns redirect for expired session", async () => {
      const user = await findOrCreateUser("expired2@example.com");
      const sessionId = await createAuthenticatedSession(user.id);

      const { computeHMAC } = await import("../utils/crypto");
      const sessionIdHash = computeHMAC(sessionId);

      await db`
        UPDATE sessions
        SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 hour'
        WHERE id_hash = ${sessionIdHash}
      `;

      const request = createBunRequest("http://localhost:3000/protected", {
        headers: { cookie: `session_id=${sessionId}` },
      });

      const result = await requireAuth(request);

      expect(result).not.toBeNull();
      expect(result?.status).toBe(303);
      expect(result?.headers.get("location")).toBe("/login");
    });
  });

  describe("guestPageContext", () => {
    test("returns redirect response for authenticated user", async () => {
      const user = await findOrCreateUser("authredirect@example.com");
      const sessionId = await createAuthenticatedSession(user.id);

      const request = createBunRequest("http://localhost:3000/login", {
        headers: { cookie: `session_id=${sessionId}` },
      });

      const result = await guestPageContext(request);

      expect("redirect" in result).toBe(true);
      if (!("redirect" in result)) return;
      expect(result.redirect.status).toBe(303);
      expect(result.redirect.headers.get("location")).toBe("/");
    });

    test("returns a context for an unauthenticated visitor", async () => {
      const request = createBunRequest("http://localhost:3000/login");

      const result = await guestPageContext(request);
      expect("ctx" in result && result.ctx.isAuthenticated).toBe(false);
    });

    test("returns a context for a guest session", async () => {
      const sessionId = await createGuestSession();

      const request = createBunRequest("http://localhost:3000/login", {
        headers: { cookie: `session_id=${sessionId}` },
      });

      const result = await guestPageContext(request);
      expect("ctx" in result && result.ctx.sessionId).toBe(sessionId);
    });

    test("returns a context for an expired session", async () => {
      const user = await findOrCreateUser("expiredredirect@example.com");
      const sessionId = await createAuthenticatedSession(user.id);

      const { computeHMAC } = await import("../utils/crypto");
      const sessionIdHash = computeHMAC(sessionId);

      await db`
        UPDATE sessions
        SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 hour'
        WHERE id_hash = ${sessionIdHash}
      `;

      const request = createBunRequest("http://localhost:3000/login", {
        headers: { cookie: `session_id=${sessionId}` },
      });

      const result = await guestPageContext(request);
      expect("ctx" in result && result.ctx.isAuthenticated).toBe(false);
    });

    test("returns a context for an invalid session", async () => {
      const request = createBunRequest("http://localhost:3000/login", {
        headers: { cookie: "session_id=invalid-session-id" },
      });

      const result = await guestPageContext(request);
      expect("ctx" in result && result.ctx.isAuthenticated).toBe(false);
    });

    // The context is what the signed-out auth pages bind their CSRF token to.
    // Dropping it meant a session row per request, no cookie, and no token.
    test("hands back a fresh guest session the caller can set a cookie for", async () => {
      const request = createBunRequest("http://localhost:3000/login");

      const result = await guestPageContext(request);

      expect("ctx" in result).toBe(true);
      if (!("ctx" in result)) return;
      expect(result.ctx.sessionId).toBeTruthy();
      expect(result.ctx.requiresSetCookie).toBe(true);
      expect(result.ctx.isGuest).toBe(true);
    });
  });

  describe("integration scenarios", () => {
    test("complete auth flow with middleware", async () => {
      const email = "integration@example.com";

      let request = createBunRequest("http://localhost:3000/protected");
      let authResult = await requireAuth(request);
      expect(authResult?.status).toBe(303);
      expect(authResult?.headers.get("location")).toBe("/login");

      request = createBunRequest("http://localhost:3000/login");
      let guestResult = await guestPageContext(request);
      expect("ctx" in guestResult).toBe(true);

      const user = await findOrCreateUser(email);
      const sessionId = await createAuthenticatedSession(user.id);

      request = createBunRequest("http://localhost:3000/protected", {
        headers: { cookie: `session_id=${sessionId}` },
      });
      authResult = await requireAuth(request);
      expect(authResult).toBeNull();

      request = createBunRequest("http://localhost:3000/login", {
        headers: { cookie: `session_id=${sessionId}` },
      });
      guestResult = await guestPageContext(request);
      expect("redirect" in guestResult).toBe(true);
      if ("redirect" in guestResult) {
        expect(guestResult.redirect.status).toBe(303);
        expect(guestResult.redirect.headers.get("location")).toBe("/");
      }

      const context = await getSessionContext(request);
      expect(context.isAuthenticated).toBe(true);
      expect(context.user?.email).toBe(email);
    });
  });
});
