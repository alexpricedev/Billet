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
  createOrganizationForUser,
  joinOrganization,
  type OrgRole,
} from "../services/organizations";
import { createAuthenticatedSession } from "../services/sessions";
import { createBunRequest } from "../test-utils/bun-request";
import { requireOrgRole } from "./org";

const ORIGINAL_TEAMS = process.env.TEAMS_ENABLED;

beforeEach(async () => {
  process.env.TEAMS_ENABLED = "true";
  await cleanupTestData(db);
});

afterAll(async () => {
  if (ORIGINAL_TEAMS === undefined) delete process.env.TEAMS_ENABLED;
  else process.env.TEAMS_ENABLED = ORIGINAL_TEAMS;

  await connection.end();
  mock.restore();
});

const request = (cookie?: string) =>
  createBunRequest(
    "http://localhost:3000/team",
    cookie ? { headers: { cookie } } : {},
  );

const asRole = async (role: OrgRole) => {
  const owner = await findOrCreateUser("owner@example.com");
  const created = await createOrganizationForUser(owner.id, "Acme");
  if (!created.success) throw new Error("seed failed");

  if (role === "owner") {
    const sessionId = await createAuthenticatedSession(owner.id);
    return `session_id=${sessionId}`;
  }

  const user = await findOrCreateUser(`${role}@example.com`);
  await joinOrganization(user.id, created.organization.id, role);
  const sessionId = await createAuthenticatedSession(user.id);
  return `session_id=${sessionId}`;
};

describe("requireOrgRole", () => {
  test("404s when the flag is off, before looking at the session", async () => {
    process.env.TEAMS_ENABLED = "false";

    const result = await requireOrgRole(request(), "admin");

    expect(result.authorized).toBe(false);
    if (result.authorized) return;
    expect(result.response.status).toBe(404);
  });

  test("sends a signed-out visitor to /login without a flash", async () => {
    const result = await requireOrgRole(request(), "admin");

    expect(result.authorized).toBe(false);
    if (result.authorized) return;
    expect(result.response.status).toBe(303);
    expect(result.response.headers.get("location")).toBe("/login");
  });

  test("sends someone with no team to / ", async () => {
    const user = await findOrCreateUser("nobody@example.com");
    const sessionId = await createAuthenticatedSession(user.id);

    const result = await requireOrgRole(
      request(`session_id=${sessionId}`),
      "admin",
    );

    expect(result.authorized).toBe(false);
    if (result.authorized) return;
    expect(result.response.headers.get("location")).toBe("/");
  });

  test("refuses a member below the minimum", async () => {
    const cookie = await asRole("member");

    const result = await requireOrgRole(request(cookie), "admin");

    expect(result.authorized).toBe(false);
    if (result.authorized) return;
    expect(result.response.headers.get("location")).toBe("/");
  });

  test("admits an admin at the admin minimum, with the membership resolved", async () => {
    const cookie = await asRole("admin");

    const result = await requireOrgRole(request(cookie), "admin");

    expect(result.authorized).toBe(true);
    if (!result.authorized) return;
    expect(result.membership.role).toBe("admin");
    expect(result.membership.org.name).toBe("Acme");
    expect(result.ctx.user?.email).toBe("admin@example.com");
  });

  test("an owner satisfies an admin minimum", async () => {
    const cookie = await asRole("owner");

    const result = await requireOrgRole(request(cookie), "admin");

    expect(result.authorized).toBe(true);
  });

  test("an admin does not satisfy an owner minimum", async () => {
    const cookie = await asRole("admin");

    const result = await requireOrgRole(request(cookie), "owner");

    expect(result.authorized).toBe(false);
  });

  test("a member satisfies a member minimum", async () => {
    const cookie = await asRole("member");

    const result = await requireOrgRole(request(cookie), "member");

    expect(result.authorized).toBe(true);
  });
});
