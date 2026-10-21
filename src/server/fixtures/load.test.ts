import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { testDatabase } from "../test-utils/database";
import { cleanupTestData } from "../test-utils/helpers";

const connection = testDatabase();

mock.module("../services/database", () => ({
  get db() {
    return connection;
  },
}));

const { loadFixtures } = await import("./load");
const { FIXTURE_PASSWORD, ORGANIZATION, PERSONAS, TODOS, ZOFIA } = await import(
  "./personas"
);
const { createAuthenticatedSession, getSessionContextFromDB } = await import(
  "../services/sessions"
);
const { signInWithPassword } = await import("../services/passwords");
const { getMembership } = await import("../services/organizations");
const { peekInvite } = await import("../services/invites");

const db = connection;

// Every table the loader writes, ordered by key. Sessions are excluded: they hold
// random ids and are minted afterwards.
const dump = async () => ({
  users: await db`SELECT * FROM users ORDER BY id`,
  organizations: await db`SELECT * FROM organizations ORDER BY id`,
  members: await db`SELECT * FROM organization_members ORDER BY id`,
  invites: await db`SELECT * FROM organization_invites ORDER BY id`,
  tokens: await db`SELECT * FROM user_tokens ORDER BY id`,
  todo: await db`SELECT * FROM todo ORDER BY id`,
});

afterAll(async () => {
  await connection.end();
  mock.restore();
});

beforeEach(async () => {
  await cleanupTestData(db);
});

describe("loadFixtures", () => {
  test("loading twice gives identical rows", async () => {
    await loadFixtures(db);
    const first = await dump();
    await loadFixtures(db);
    expect(await dump()).toEqual(first);
    expect(first.users).toHaveLength(PERSONAS.length);
    expect(first.todo).toHaveLength(TODOS.length);
  });

  test("replaces whatever was there", async () => {
    await db`INSERT INTO users (email) VALUES ('stray@example.com')`;
    await loadFixtures(db);
    const stray =
      await db`SELECT 1 FROM users WHERE email = 'stray@example.com'`;
    expect(stray).toHaveLength(0);
  });

  test("every account persona gets a session that resolves to them", async () => {
    await loadFixtures(db);
    for (const persona of PERSONAS) {
      const [row] =
        await db`SELECT id FROM users WHERE email = ${persona.email}`;
      const raw = await createAuthenticatedSession(row.id);
      const ctx = await getSessionContextFromDB(raw);
      expect(ctx?.user?.email).toBe(persona.email);
      expect(ctx?.user?.role).toBe(persona.role);
    }
  });

  test("org standing matches the personas", async () => {
    await loadFixtures(db);
    for (const persona of PERSONAS) {
      const membership = await getMembership(persona.id);
      expect(membership?.role ?? null).toBe(persona.orgRole);
      if (membership) expect(membership.org.id).toBe(ORGANIZATION.id);
    }
  });

  test("Zofia has a live invite and no account", async () => {
    await loadFixtures(db);
    const users = await db`SELECT 1 FROM users WHERE email = ${ZOFIA.email}`;
    expect(users).toHaveLength(0);
    const preview = await peekInvite(ZOFIA.inviteToken);
    expect(preview?.email).toBe(ZOFIA.email);
    expect(preview?.organizationName).toBe("Northwind");
  });

  test("Jo has no optional fields set", async () => {
    await loadFixtures(db);
    const [jo] = await db`
      SELECT password_hash, email_verified_at FROM users WHERE email = 'jo@example.com'
    `;
    expect(jo.password_hash).toBeNull();
    expect(jo.email_verified_at).toBeNull();
  });

  test("the todo sequence continues after the fixture ids", async () => {
    await loadFixtures(db);
    const [row] =
      await db`INSERT INTO todo (title) VALUES ('next') RETURNING id`;
    expect(row.id).toBe(Math.max(...TODOS.map((t) => t.id)) + 1);
  });

  test("Priya signs in with the fixture password", async () => {
    await loadFixtures(db);
    const result = await signInWithPassword(
      "priya@example.com",
      FIXTURE_PASSWORD,
    );
    expect(result.success).toBe(true);
  });
});
