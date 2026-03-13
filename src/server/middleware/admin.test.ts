import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { SQL } from "bun";
import { cleanupTestData } from "../test-utils/helpers";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for tests");
}
const connection = new SQL(process.env.DATABASE_URL);

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
import { requireAdmin } from "./admin";

describe("Admin Middleware", () => {
  beforeEach(async () => {
    await cleanupTestData(db);
  });

  afterAll(async () => {
    await connection.end();
    mock.restore();
  });

  test("returns authorized with session context for admin user", async () => {
    const user = await findOrCreateUser("admin@example.com");
    await db`UPDATE users SET role = 'admin' WHERE id = ${user.id}`;
    const sessionId = await createAuthenticatedSession(user.id);

    const request = createBunRequest("http://localhost:3000/admin", {
      headers: { cookie: `session_id=${sessionId}` },
    });

    const result = await requireAdmin(request);
    expect(result.authorized).toBe(true);
    if (result.authorized) {
      expect(result.ctx.user?.email).toBe("admin@example.com");
      expect(result.ctx.user?.role).toBe("admin");
    }
  });

  test("redirects unauthenticated user to /login", async () => {
    const request = createBunRequest("http://localhost:3000/admin");

    const result = await requireAdmin(request);

    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.response.status).toBe(303);
      expect(result.response.headers.get("location")).toBe("/login");
    }
  });

  test("redirects guest session to /login", async () => {
    const sessionId = await createGuestSession();

    const request = createBunRequest("http://localhost:3000/admin", {
      headers: { cookie: `session_id=${sessionId}` },
    });

    const result = await requireAdmin(request);

    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.response.status).toBe(303);
      expect(result.response.headers.get("location")).toBe("/login");
    }
  });

  test("redirects non-admin authenticated user to / with flash message", async () => {
    const user = await findOrCreateUser("regular@example.com");
    const sessionId = await createAuthenticatedSession(user.id);

    const request = createBunRequest("http://localhost:3000/admin", {
      headers: { cookie: `session_id=${sessionId}` },
    });

    const result = await requireAdmin(request);

    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.response.status).toBe(303);
      expect(result.response.headers.get("location")).toBe("/");
    }
  });

  test("redirects expired session to /login", async () => {
    const user = await findOrCreateUser("expired-admin@example.com");
    await db`UPDATE users SET role = 'admin' WHERE id = ${user.id}`;
    const sessionId = await createAuthenticatedSession(user.id);

    const { computeHMAC } = await import("../utils/crypto");
    const sessionIdHash = computeHMAC(sessionId);

    await db`
      UPDATE sessions
      SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 hour'
      WHERE id_hash = ${sessionIdHash}
    `;

    const request = createBunRequest("http://localhost:3000/admin", {
      headers: { cookie: `session_id=${sessionId}` },
    });

    const result = await requireAdmin(request);

    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.response.status).toBe(303);
      expect(result.response.headers.get("location")).toBe("/login");
    }
  });
});
