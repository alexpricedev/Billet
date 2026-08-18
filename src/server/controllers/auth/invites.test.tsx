import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { SQL } from "bun";
import { clearRateLimitLog } from "../../middleware/rate-limit";
import { createBunRequest, findSetCookie } from "../../test-utils/bun-request";
import { cleanupTestData, randomEmail } from "../../test-utils/helpers";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for tests");
}
const connection = new SQL(process.env.DATABASE_URL);

mock.module("../../services/database", () => ({
  get db() {
    return connection;
  },
}));

import { createCsrfToken } from "../../services/csrf";
import { db } from "../../services/database";
import {
  createInvite,
  signUpIntoOrganisation,
  signUpWithOrganisation,
} from "../../services/organisations";
import { createAuthenticatedSession } from "../../services/sessions";
import { invites } from "./invites";

const ORIGIN = process.env.APP_URL as string;
const PASSWORD = "correct-horse-battery";

const getAccept = (token: string, sessionId?: string) =>
  createBunRequest(
    `${ORIGIN}/invites/accept?token=${encodeURIComponent(token)}`,
    {
      method: "GET",
      ...(sessionId ? { headers: { cookie: `session_id=${sessionId}` } } : {}),
    },
  );

const postAccept = async (
  fields: Record<string, string>,
  sessionId?: string,
  withCsrf = true,
) => {
  const formData = new FormData();
  if (sessionId && withCsrf) {
    formData.append(
      "_csrf",
      await createCsrfToken(sessionId, "POST", "/invites/accept"),
    );
  }
  for (const [key, value] of Object.entries(fields)) {
    formData.append(key, value);
  }

  return createBunRequest(`${ORIGIN}/invites/accept`, {
    method: "POST",
    headers: {
      origin: ORIGIN,
      ...(sessionId ? { cookie: `session_id=${sessionId}` } : {}),
    },
    body: formData,
  });
};

/** An owner with a live invitation outstanding. */
const setupInvite = async (inviteeEmail = randomEmail()) => {
  const owner = await signUpWithOrganisation(randomEmail(), "Acme");
  if (!owner.success) throw new Error("setup failed");

  const invite = await createInvite(
    owner.organisation.id,
    inviteeEmail,
    owner.user.id,
  );
  if (!invite.success) throw new Error("setup failed");

  return { owner, invite, inviteeEmail: inviteeEmail.toLowerCase() };
};

const membershipCount = async (organisationId: string) =>
  (
    await db`SELECT id FROM organisation_members WHERE organisation_id = ${organisationId}`
  ).length;

describe("Invites Controller", () => {
  const originalOrgs = process.env.ORGANISATIONS_ENABLED;
  const originalMode = process.env.AUTH_MODE;

  beforeEach(async () => {
    await cleanupTestData(db);
    clearRateLimitLog();
    process.env.ORGANISATIONS_ENABLED = "true";
    delete process.env.AUTH_MODE;
  });

  afterAll(async () => {
    if (originalOrgs === undefined) delete process.env.ORGANISATIONS_ENABLED;
    else process.env.ORGANISATIONS_ENABLED = originalOrgs;
    if (originalMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = originalMode;
    await connection.end();
    mock.restore();
  });

  describe("when the flag is off", () => {
    test("both routes 404", async () => {
      const { invite } = await setupInvite();
      delete process.env.ORGANISATIONS_ENABLED;

      expect((await invites.edit(getAccept(invite.rawToken))).status).toBe(404);
      expect(
        (await invites.update(await postAccept({ token: invite.rawToken })))
          .status,
      ).toBe(404);
    });
  });

  describe("GET /invites/accept", () => {
    test("names the organisation and the invited address", async () => {
      const { invite, inviteeEmail } = await setupInvite();

      const html = await (
        await invites.edit(getAccept(invite.rawToken))
      ).text();

      expect(html).toContain("Acme");
      expect(html).toContain(inviteeEmail);
    });

    test("404s without a token", async () => {
      const request = createBunRequest(`${ORIGIN}/invites/accept`, {
        method: "GET",
      });
      expect((await invites.edit(request)).status).toBe(404);
    });

    test("404s on a token that isn't real", async () => {
      expect((await invites.edit(getAccept("made-up"))).status).toBe(404);
    });

    test("404s on an expired invitation", async () => {
      const { invite } = await setupInvite();
      await db`
        UPDATE organisation_invites
        SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 day'
      `;

      expect((await invites.edit(getAccept(invite.rawToken))).status).toBe(404);
    });

    test("offers a password field in password mode", async () => {
      process.env.AUTH_MODE = "password";
      const { invite } = await setupInvite();

      const html = await (
        await invites.edit(getAccept(invite.rawToken))
      ).text();
      expect(html).toContain('name="password"');
    });

    test("offers no password field in magic-link mode", async () => {
      const { invite } = await setupInvite();

      const html = await (
        await invites.edit(getAccept(invite.rawToken))
      ).text();
      expect(html).not.toContain('name="password"');
    });
  });

  describe("POST /invites/accept — new account", () => {
    test("creates the user at the invited address and signs them in", async () => {
      const { owner, invite, inviteeEmail } = await setupInvite();

      const request = await postAccept({ token: invite.rawToken });
      const response = await invites.update(request);

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/organisation");
      expect(findSetCookie(request, "session_id")).toBeDefined();

      const users =
        await db`SELECT email FROM users WHERE email = ${inviteeEmail}`;
      expect(users).toHaveLength(1);
      expect(await membershipCount(owner.organisation.id)).toBe(2);
    });

    test("ignores an email supplied in the form", async () => {
      const { invite, inviteeEmail } = await setupInvite();

      await invites.update(
        await postAccept({
          token: invite.rawToken,
          email: "attacker@example.com",
        }),
      );

      // The account belongs to the invited address, not the posted one.
      expect(
        await db`SELECT id FROM users WHERE email = 'attacker@example.com'`,
      ).toHaveLength(0);
      expect(
        await db`SELECT id FROM users WHERE email = ${inviteeEmail}`,
      ).toHaveLength(1);
    });

    test("joins as a member, not an owner", async () => {
      const { owner, invite, inviteeEmail } = await setupInvite();
      await invites.update(await postAccept({ token: invite.rawToken }));

      const rows = await db`
        SELECT m.role FROM organisation_members m
        JOIN users u ON u.id = m.user_id
        WHERE u.email = ${inviteeEmail} AND m.organisation_id = ${owner.organisation.id}
      `;
      expect(rows[0].role).toBe("member");
    });

    test("cannot be accepted twice", async () => {
      const { owner, invite } = await setupInvite();

      await invites.update(await postAccept({ token: invite.rawToken }));
      const second = await invites.update(
        await postAccept({ token: invite.rawToken }),
      );

      expect(second.status).toBe(404);
      expect(await membershipCount(owner.organisation.id)).toBe(2);
    });

    test("sets the password in password mode", async () => {
      process.env.AUTH_MODE = "password";
      const { invite, inviteeEmail } = await setupInvite();

      await invites.update(
        await postAccept({ token: invite.rawToken, password: PASSWORD }),
      );

      const rows =
        await db`SELECT password_hash FROM users WHERE email = ${inviteeEmail}`;
      expect(rows[0].password_hash).not.toBeNull();
    });

    test("a rejected password does not burn the invitation", async () => {
      process.env.AUTH_MODE = "password";
      const { invite, inviteeEmail } = await setupInvite();

      const response = await invites.update(
        await postAccept({ token: invite.rawToken, password: "short" }),
      );

      expect(response.status).toBe(303);
      expect(
        await db`SELECT id FROM users WHERE email = ${inviteeEmail}`,
      ).toHaveLength(0);

      // Still usable — the whole point of validating before claiming.
      const rows = await db`SELECT accepted_at FROM organisation_invites`;
      expect(rows[0].accepted_at).toBeNull();
    });

    test("404s on an expired invitation", async () => {
      const { invite } = await setupInvite();
      await db`
        UPDATE organisation_invites
        SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 day'
      `;

      expect(
        (await invites.update(await postAccept({ token: invite.rawToken })))
          .status,
      ).toBe(404);
    });

    test("rate limits repeated attempts", async () => {
      const { invite } = await setupInvite();

      for (let i = 0; i < 5; i++) {
        await invites.update(await postAccept({ token: "wrong" }));
      }

      expect(
        (await invites.update(await postAccept({ token: invite.rawToken })))
          .status,
      ).toBe(429);
    });
  });

  describe("POST /invites/accept — already signed in", () => {
    test("joins the existing account without creating one", async () => {
      const { owner, invite } = await setupInvite();

      // Someone with an account but no organisation — only reachable in a
      // database that predates the flag, which is exactly who might be invited.
      const rows = await db`
        INSERT INTO users (id, email) VALUES (gen_random_uuid(), ${randomEmail()})
        RETURNING id
      `;
      const sessionId = await createAuthenticatedSession(rows[0].id);

      const response = await invites.update(
        await postAccept({ token: invite.rawToken }, sessionId),
      );

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/organisation");
      expect(await membershipCount(owner.organisation.id)).toBe(2);
    });

    test("refuses when they already belong to an organisation", async () => {
      const { owner, invite } = await setupInvite();

      const other = await signUpWithOrganisation(randomEmail(), "Other");
      if (!other.success) throw new Error("setup failed");
      const sessionId = await createAuthenticatedSession(other.user.id);

      const request = await postAccept({ token: invite.rawToken }, sessionId);
      const response = await invites.update(request);

      expect(response.status).toBe(303);
      expect(
        decodeURIComponent(findSetCookie(request, "flash_state") ?? ""),
      ).toContain("already belong");
      expect(await membershipCount(owner.organisation.id)).toBe(1);
    });

    test("rejects a signed-in POST with no CSRF token", async () => {
      const { owner, invite } = await setupInvite();

      const member = await signUpIntoOrganisation(
        randomEmail(),
        owner.organisation.id,
      );
      if (!member.success) throw new Error("setup failed");
      const sessionId = await createAuthenticatedSession(member.user.id);

      const response = await invites.update(
        await postAccept({ token: invite.rawToken }, sessionId, false),
      );

      expect(response.status).toBe(403);
      const rows = await db`SELECT accepted_at FROM organisation_invites`;
      expect(rows[0].accepted_at).toBeNull();
    });
  });
});
