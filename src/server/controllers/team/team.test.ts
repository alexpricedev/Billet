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

import { findOrCreateUser } from "../../services/auth";
import { createCsrfToken } from "../../services/csrf";
import { db } from "../../services/database";
import { createInvite, listInvites } from "../../services/invites";
import {
  createOrganizationForUser,
  getMembership,
  joinOrganization,
  type OrgRole,
} from "../../services/organizations";
import { createAuthenticatedSession } from "../../services/sessions";
import { createBunRequest, findSetCookie } from "../../test-utils/bun-request";
import { team } from "./dashboard";
import { teamInvites } from "./invites";
import { teamMembers } from "./members";

const ORIGINAL_TEAMS = process.env.TEAMS_ENABLED;

// Pinned off in run-tests.ts, so this file opts itself in per the same
// convention the password-mode controller tests follow.
beforeEach(async () => {
  process.env.TEAMS_ENABLED = "true";
  await cleanupTestData(db);
});

afterAll(async () => {
  if (ORIGINAL_TEAMS === undefined) {
    delete process.env.TEAMS_ENABLED;
  } else {
    process.env.TEAMS_ENABLED = ORIGINAL_TEAMS;
  }
  await connection.end();
  mock.restore();
});

const signedIn = async (email: string) => {
  const user = await findOrCreateUser(email);
  const sessionId = await createAuthenticatedSession(user.id);
  return { user, sessionId, cookie: `session_id=${sessionId}` };
};

const withOrg = async (
  email = "owner@example.com",
  role: OrgRole = "owner",
) => {
  const actor = await signedIn(email);
  const created = await createOrganizationForUser(actor.user.id, "Acme");
  if (!created.success) throw new Error("seed failed");

  if (role !== "owner") {
    await db`UPDATE organization_members SET org_role = ${role} WHERE user_id = ${actor.user.id}`;
  }

  return { ...actor, org: created.organization };
};

const addMember = async (
  orgId: string,
  email: string,
  role: OrgRole = "member",
) => {
  const user = await findOrCreateUser(email);
  await joinOrganization(user.id, orgId, role);
  return user;
};

const post = async (
  path: string,
  cookie: string,
  sessionId: string,
  fields: Record<string, string>,
  params: Record<string, string> = {},
) => {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.append(key, value);
  body.append("_csrf", await createCsrfToken(sessionId, "POST", path));

  return createBunRequest(
    `http://localhost:3000${path}`,
    {
      method: "POST",
      headers: { Origin: "http://localhost:3000", Cookie: cookie },
      body,
    },
    params,
  );
};

describe("Team dashboard", () => {
  test("404s on GET and POST when the flag is off", async () => {
    process.env.TEAMS_ENABLED = "false";
    const actor = await signedIn("nobody@example.com");

    const get = await team.index(
      createBunRequest("http://localhost:3000/team", {
        headers: { cookie: actor.cookie },
      }),
    );
    expect(get.status).toBe(404);

    const create = await team.create(
      await post("/team", actor.cookie, actor.sessionId, { name: "Acme" }),
    );
    expect(create.status).toBe(404);
  });

  test("redirects a signed-out visitor to /login", async () => {
    const response = await team.index(
      createBunRequest("http://localhost:3000/team"),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login");
  });

  test("offers the create form to someone with no team", async () => {
    const actor = await signedIn("nobody@example.com");

    const response = await team.index(
      createBunRequest("http://localhost:3000/team", {
        headers: { cookie: actor.cookie },
      }),
    );

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Create a team");
    expect(html).toContain('name="_csrf"');
  });

  test("a plain member is bounced to / rather than shown the page", async () => {
    const owner = await withOrg();
    const member = await addMember(owner.org.id, "member@example.com");
    const sessionId = await createAuthenticatedSession(member.id);

    const response = await team.index(
      createBunRequest("http://localhost:3000/team", {
        headers: { cookie: `session_id=${sessionId}` },
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
  });

  test("renders members and pending invites for an admin", async () => {
    const owner = await withOrg();
    await addMember(owner.org.id, "member@example.com");
    await createInvite(
      owner.org.id,
      "pending@example.com",
      "member",
      owner.user.id,
    );

    const response = await team.index(
      createBunRequest("http://localhost:3000/team", {
        headers: { cookie: owner.cookie },
      }),
    );

    const html = await response.text();
    expect(html).toContain("owner@example.com");
    expect(html).toContain("member@example.com");
    expect(html).toContain("pending@example.com");
    expect(html).toContain("Pending invitations");
  });

  test("creates a team and makes the caller its owner", async () => {
    const actor = await signedIn("founder@example.com");

    const response = await team.create(
      await post("/team", actor.cookie, actor.sessionId, { name: "Acme" }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/team");
    expect((await getMembership(actor.user.id))?.role).toBe("owner");
  });

  test("rejects a create without a CSRF token", async () => {
    const actor = await signedIn("founder@example.com");

    const body = new FormData();
    body.append("name", "Acme");

    const response = await team.create(
      createBunRequest("http://localhost:3000/team", {
        method: "POST",
        headers: { Origin: "http://localhost:3000", Cookie: actor.cookie },
        body,
      }),
    );

    expect(response.status).toBe(403);
    expect(await getMembership(actor.user.id)).toBeNull();
  });
});

describe("Team invites", () => {
  test("404s when the flag is off", async () => {
    process.env.TEAMS_ENABLED = "false";
    const actor = await signedIn("owner@example.com");

    const response = await teamInvites.create(
      await post("/team/invites", actor.cookie, actor.sessionId, {
        email: "x@example.com",
        org_role: "member",
      }),
    );

    expect(response.status).toBe(404);
  });

  test("an admin can invite", async () => {
    const owner = await withOrg();

    const response = await teamInvites.create(
      await post("/team/invites", owner.cookie, owner.sessionId, {
        email: "new@example.com",
        org_role: "member",
      }),
    );

    expect(response.status).toBe(303);
    const pending = await listInvites(owner.org.id);
    expect(pending.map((i) => i.email)).toEqual(["new@example.com"]);
  });

  test("a plain member cannot invite", async () => {
    const owner = await withOrg();
    const member = await addMember(owner.org.id, "member@example.com");
    const sessionId = await createAuthenticatedSession(member.id);

    const response = await teamInvites.create(
      await post("/team/invites", `session_id=${sessionId}`, sessionId, {
        email: "new@example.com",
        org_role: "member",
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
    expect((await listInvites(owner.org.id)).length).toBe(0);
  });

  test("owner cannot be handed out by invitation", async () => {
    const owner = await withOrg();

    await teamInvites.create(
      await post("/team/invites", owner.cookie, owner.sessionId, {
        email: "new@example.com",
        org_role: "owner",
      }),
    );

    expect((await listInvites(owner.org.id)).length).toBe(0);
  });

  test("another org's invite cannot be revoked", async () => {
    const owner = await withOrg();
    const other = await withOrg("other@example.com");
    const created = await createInvite(
      other.org.id,
      "theirs@example.com",
      "member",
      other.user.id,
    );
    if (!created.success) throw new Error("seed failed");

    const path = `/team/invites/${created.invite.id}/revoke`;
    const response = await teamInvites.destroy(
      await post(
        path,
        owner.cookie,
        owner.sessionId,
        {},
        {
          id: created.invite.id,
        },
      ),
    );

    expect(response.status).toBe(303);
    expect((await listInvites(other.org.id)).length).toBe(1);
  });
});

describe("Team members", () => {
  test("404s when the flag is off", async () => {
    process.env.TEAMS_ENABLED = "false";
    const actor = await signedIn("owner@example.com");

    const path = "/team/members/abc/remove";
    const response = await teamMembers.destroy(
      await post(path, actor.cookie, actor.sessionId, {}, { id: "abc" }),
    );

    expect(response.status).toBe(404);
  });

  test("an admin may promote a member to admin", async () => {
    const owner = await withOrg();
    const member = await addMember(owner.org.id, "member@example.com");

    const path = `/team/members/${member.id}/role`;
    await teamMembers.updateRole(
      await post(
        path,
        owner.cookie,
        owner.sessionId,
        { org_role: "admin" },
        {
          id: member.id,
        },
      ),
    );

    expect((await getMembership(member.id))?.role).toBe("admin");
  });

  test("an admin may not grant ownership, even to themselves", async () => {
    const owner = await withOrg();
    const admin = await addMember(owner.org.id, "admin@example.com", "admin");
    const sessionId = await createAuthenticatedSession(admin.id);

    const path = `/team/members/${admin.id}/role`;
    const response = await teamMembers.updateRole(
      await post(
        path,
        `session_id=${sessionId}`,
        sessionId,
        { org_role: "owner" },
        { id: admin.id },
      ),
    );

    expect(response.status).toBe(303);
    expect((await getMembership(admin.id))?.role).toBe("admin");
  });

  test("an admin may not act on an owner", async () => {
    const owner = await withOrg();
    const admin = await addMember(owner.org.id, "admin@example.com", "admin");
    const sessionId = await createAuthenticatedSession(admin.id);

    const path = `/team/members/${owner.user.id}/remove`;
    await teamMembers.destroy(
      await post(
        path,
        `session_id=${sessionId}`,
        sessionId,
        {},
        {
          id: owner.user.id,
        },
      ),
    );

    expect(await getMembership(owner.user.id)).not.toBeNull();
  });

  // Nobody edits their own role, whatever it is. The last-owner invariant is a
  // separate rule, enforced inside the UPDATE and covered in
  // organizations.test.ts — this is the one that stops the trapdoor.
  test("an owner cannot demote themselves", async () => {
    const owner = await withOrg();

    const path = `/team/members/${owner.user.id}/role`;
    const request = await post(
      path,
      owner.cookie,
      owner.sessionId,
      { org_role: "member" },
      { id: owner.user.id },
    );
    await teamMembers.updateRole(request);

    expect(findSetCookie(request, "flash_state")).toContain("self-role-change");
    expect((await getMembership(owner.user.id))?.role).toBe("owner");
  });

  test("an admin cannot demote themselves out of the page", async () => {
    const owner = await withOrg();
    const admin = await addMember(owner.org.id, "admin@example.com", "admin");
    const sessionId = await createAuthenticatedSession(admin.id);

    const path = `/team/members/${admin.id}/role`;
    const request = await post(
      path,
      `session_id=${sessionId}`,
      sessionId,
      { org_role: "member" },
      { id: admin.id },
    );
    await teamMembers.updateRole(request);

    expect(findSetCookie(request, "flash_state")).toContain("self-role-change");
    expect((await getMembership(admin.id))?.role).toBe("admin");
  });

  test("a member of another org is inert, not a mutation", async () => {
    const owner = await withOrg();
    const other = await withOrg("other@example.com");
    const theirs = await addMember(other.org.id, "theirs@example.com");

    const path = `/team/members/${theirs.id}/role`;
    const response = await teamMembers.updateRole(
      await post(
        path,
        owner.cookie,
        owner.sessionId,
        { org_role: "admin" },
        {
          id: theirs.id,
        },
      ),
    );

    expect(response.status).toBe(303);
    expect((await getMembership(theirs.id))?.role).toBe("member");
  });

  test("removing yourself is refused, not a way to leave the team", async () => {
    const owner = await withOrg();
    const admin = await addMember(owner.org.id, "admin@example.com", "admin");
    const sessionId = await createAuthenticatedSession(admin.id);

    const path = `/team/members/${admin.id}/remove`;
    const request = await post(
      path,
      `session_id=${sessionId}`,
      sessionId,
      {},
      { id: admin.id },
    );
    const response = await teamMembers.destroy(request);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/team");
    // The hidden button is cosmetic; this is the server refusing.
    expect(findSetCookie(request, "flash_state")).toContain("self-removal");
    expect((await getMembership(admin.id))?.role).toBe("admin");
  });

  test("a role change without a CSRF token is refused", async () => {
    const owner = await withOrg();
    const member = await addMember(owner.org.id, "member@example.com");

    const body = new FormData();
    body.append("org_role", "admin");

    const response = await teamMembers.updateRole(
      createBunRequest(
        `http://localhost:3000/team/members/${member.id}/role`,
        {
          method: "POST",
          headers: { Origin: "http://localhost:3000", Cookie: owner.cookie },
          body,
        },
        { id: member.id },
      ),
    );

    expect(response.status).toBe(403);
    expect((await getMembership(member.id))?.role).toBe("member");
  });
});
