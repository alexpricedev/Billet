import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { SQL } from "bun";
import { cleanupTestData } from "../test-utils/helpers";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for tests");
}
const connection = new SQL(process.env.DATABASE_URL);

mock.module("./database", () => ({
  get db() {
    return connection;
  },
}));

const {
  createGuestSession,
  createAuthenticatedSession,
  getSessionContextFromDB,
  convertGuestToAuthenticated,
  deleteSession,
  renewSession,
} = await import("./sessions");

const { findOrCreateUser } = await import("./auth");
const { computeHMAC } = await import("../utils/crypto");

const db = connection;

afterAll(async () => {
  await connection.end();
  mock.restore();
});

beforeEach(async () => {
  await cleanupTestData(db);
});

describe("createGuestSession", () => {
  test("creates a session with type guest and null user_id", async () => {
    const rawId = await createGuestSession();
    expect(rawId).toBeTruthy();

    const hash = computeHMAC(rawId);
    const rows = await db`SELECT * FROM sessions WHERE id_hash = ${hash}`;
    expect(rows).toHaveLength(1);
    expect(rows[0].session_type).toBe("guest");
    expect(rows[0].user_id).toBeNull();
  });

  test("guest session expires in ~24 hours", async () => {
    const rawId = await createGuestSession();
    const hash = computeHMAC(rawId);
    const rows =
      await db`SELECT expires_at FROM sessions WHERE id_hash = ${hash}`;
    const expiresAt = new Date(rows[0].expires_at);
    const diff = expiresAt.getTime() - Date.now();
    const hours = diff / (1000 * 60 * 60);
    expect(hours).toBeGreaterThan(23);
    expect(hours).toBeLessThan(25);
  });
});

describe("createAuthenticatedSession", () => {
  test("creates a session with type authenticated and user_id", async () => {
    const user = await findOrCreateUser("test@example.com");
    const rawId = await createAuthenticatedSession(user.id);

    const hash = computeHMAC(rawId);
    const rows = await db`SELECT * FROM sessions WHERE id_hash = ${hash}`;
    expect(rows).toHaveLength(1);
    expect(rows[0].session_type).toBe("authenticated");
    expect(rows[0].user_id).toBe(user.id);
  });

  test("authenticated session expires in ~30 days", async () => {
    const user = await findOrCreateUser("test@example.com");
    const rawId = await createAuthenticatedSession(user.id);
    const hash = computeHMAC(rawId);
    const rows =
      await db`SELECT expires_at FROM sessions WHERE id_hash = ${hash}`;
    const expiresAt = new Date(rows[0].expires_at);
    const diff = expiresAt.getTime() - Date.now();
    const days = diff / (1000 * 60 * 60 * 24);
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThan(31);
  });
});

describe("getSessionContextFromDB", () => {
  test("returns null for non-existent session", async () => {
    const result = await getSessionContextFromDB("non-existent-id");
    expect(result).toBeNull();
  });

  test("returns guest context for guest session", async () => {
    const rawId = await createGuestSession();
    const ctx = await getSessionContextFromDB(rawId);

    expect(ctx).not.toBeNull();
    expect(ctx?.sessionType).toBe("guest");
    expect(ctx?.isGuest).toBe(true);
    expect(ctx?.isAuthenticated).toBe(false);
    expect(ctx?.user).toBeNull();
    expect(ctx?.sessionId).toBe(rawId);
    expect(ctx?.sessionHash).toBeTruthy();
  });

  test("returns authenticated context with user for authenticated session", async () => {
    const user = await findOrCreateUser("auth@example.com");
    const rawId = await createAuthenticatedSession(user.id);
    const ctx = await getSessionContextFromDB(rawId);

    expect(ctx).not.toBeNull();
    expect(ctx?.sessionType).toBe("authenticated");
    expect(ctx?.isGuest).toBe(false);
    expect(ctx?.isAuthenticated).toBe(true);
    expect(ctx?.user).not.toBeNull();
    expect(ctx?.user?.email).toBe("auth@example.com");
  });

  test("returns null for expired session", async () => {
    const rawId = await createGuestSession();
    const hash = computeHMAC(rawId);
    await db`UPDATE sessions SET expires_at = NOW() - INTERVAL '1 hour' WHERE id_hash = ${hash}`;

    const ctx = await getSessionContextFromDB(rawId);
    expect(ctx).toBeNull();
  });
});

describe("convertGuestToAuthenticated", () => {
  test("converts guest session to authenticated", async () => {
    const rawId = await createGuestSession();
    const hash = computeHMAC(rawId);
    const user = await findOrCreateUser("upgrade@example.com");

    const result = await convertGuestToAuthenticated(hash, user.id);
    expect(result).toBe(true);

    const rows = await db`SELECT * FROM sessions WHERE id_hash = ${hash}`;
    expect(rows[0].session_type).toBe("authenticated");
    expect(rows[0].user_id).toBe(user.id);
  });

  test("extends expiry to 30 days on conversion", async () => {
    const rawId = await createGuestSession();
    const hash = computeHMAC(rawId);
    const user = await findOrCreateUser("upgrade@example.com");

    await convertGuestToAuthenticated(hash, user.id);

    const rows =
      await db`SELECT expires_at FROM sessions WHERE id_hash = ${hash}`;
    const expiresAt = new Date(rows[0].expires_at);
    const days = (expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    expect(days).toBeGreaterThan(29);
  });

  test("returns false for already-authenticated session", async () => {
    const user = await findOrCreateUser("auth@example.com");
    const rawId = await createAuthenticatedSession(user.id);
    const hash = computeHMAC(rawId);

    const result = await convertGuestToAuthenticated(hash, user.id);
    expect(result).toBe(false);
  });

  test("returns false for expired guest session", async () => {
    const rawId = await createGuestSession();
    const hash = computeHMAC(rawId);
    await db`UPDATE sessions SET expires_at = NOW() - INTERVAL '1 hour' WHERE id_hash = ${hash}`;

    const user = await findOrCreateUser("upgrade@example.com");
    const result = await convertGuestToAuthenticated(hash, user.id);
    expect(result).toBe(false);
  });
});

describe("deleteSession", () => {
  test("deletes an existing session", async () => {
    const rawId = await createGuestSession();
    const result = await deleteSession(rawId);
    expect(result).toBe(true);

    const hash = computeHMAC(rawId);
    const rows = await db`SELECT * FROM sessions WHERE id_hash = ${hash}`;
    expect(rows).toHaveLength(0);
  });

  test("returns false for non-existent session", async () => {
    const result = await deleteSession("non-existent");
    expect(result).toBe(false);
  });
});

describe("renewSession", () => {
  test("updates last_activity_at", async () => {
    const user = await findOrCreateUser("renew@example.com");
    const rawId = await createAuthenticatedSession(user.id);
    const hash = computeHMAC(rawId);

    const before =
      await db`SELECT last_activity_at FROM sessions WHERE id_hash = ${hash}`;
    await new Promise((r) => setTimeout(r, 50));
    await renewSession(rawId);
    const after =
      await db`SELECT last_activity_at FROM sessions WHERE id_hash = ${hash}`;

    expect(new Date(after[0].last_activity_at).getTime()).toBeGreaterThan(
      new Date(before[0].last_activity_at).getTime(),
    );
  });
});
