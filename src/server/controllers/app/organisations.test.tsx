import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { SQL } from "bun";
import { clearRateLimitLog } from "../../middleware/rate-limit";
import { createBunRequest } from "../../test-utils/bun-request";
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

const sentInvites: { to: string; organisationName: string }[] = [];
mock.module("../../services/email", () => ({
  getEmailService: () => ({
    sendOrganisationInvite: async (data: {
      to: { email: string };
      organisationName: string;
    }) => {
      sentInvites.push({
        to: data.to.email,
        organisationName: data.organisationName,
      });
    },
  }),
}));

import { createCsrfToken } from "../../services/csrf";
import { db } from "../../services/database";
import {
  createInvite,
  signUpIntoOrganisation,
  signUpWithOrganisation,
} from "../../services/organisations";
import { createAuthenticatedSession } from "../../services/sessions";
import { organisations } from "./organisations";

const ORIGIN = process.env.APP_URL as string;

const getPage = (sessionId?: string) =>
  createBunRequest(`${ORIGIN}/organisation`, {
    method: "GET",
    ...(sessionId ? { headers: { cookie: `session_id=${sessionId}` } } : {}),
  });

const postInvite = async (
  sessionId: string,
  fields: Record<string, string>,
  withCsrf = true,
) => {
  const formData = new FormData();
  if (withCsrf) {
    formData.append(
      "_csrf",
      await createCsrfToken(sessionId, "POST", "/organisation/invites"),
    );
  }
  for (const [key, value] of Object.entries(fields)) {
    formData.append(key, value);
  }

  return createBunRequest(`${ORIGIN}/organisation/invites`, {
    method: "POST",
    headers: { origin: ORIGIN, cookie: `session_id=${sessionId}` },
    body: formData,
  });
};

const postRevoke = async (sessionId: string, inviteId: string) => {
  const path = `/organisation/invites/${inviteId}/delete`;
  const formData = new FormData();
  formData.append("_csrf", await createCsrfToken(sessionId, "POST", path));

  return createBunRequest<"/organisation/invites/:id/delete">(
    `${ORIGIN}${path}`,
    {
      method: "POST",
      headers: { origin: ORIGIN, cookie: `session_id=${sessionId}` },
      body: formData,
    },
    { id: inviteId },
  );
};

/** An owner with a live session, which is what most of these need. */
const setupOwner = async (name = "Acme") => {
  const result = await signUpWithOrganisation(randomEmail(), name);
  if (!result.success) throw new Error("setup failed");

  return {
    ...result,
    sessionId: await createAuthenticatedSession(result.user.id),
  };
};

describe("Organisations Controller", () => {
  const originalOrgs = process.env.ORGANISATIONS_ENABLED;

  beforeEach(async () => {
    await cleanupTestData(db);
    clearRateLimitLog();
    sentInvites.length = 0;
    process.env.ORGANISATIONS_ENABLED = "true";
  });

  afterAll(async () => {
    if (originalOrgs === undefined) delete process.env.ORGANISATIONS_ENABLED;
    else process.env.ORGANISATIONS_ENABLED = originalOrgs;
    await connection.end();
    mock.restore();
  });

  describe("when the flag is off", () => {
    beforeEach(() => {
      delete process.env.ORGANISATIONS_ENABLED;
    });

    test("every route 404s", async () => {
      expect((await organisations.index(getPage())).status).toBe(404);
      expect(
        (await organisations.invite(await postInvite("x", {}, false))).status,
      ).toBe(404);
    });
  });

  describe("GET /organisation", () => {
    test("redirects a signed-out visitor to login", async () => {
      const response = await organisations.index(getPage());

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/login");
    });

    test("shows the organisation, its members and the invite form", async () => {
      const owner = await setupOwner("Acme");
      const html = await (
        await organisations.index(getPage(owner.sessionId))
      ).text();

      expect(html).toContain("Acme");
      expect(html).toContain(owner.user.email);
      expect(html).toContain("owner");
      expect(html).toContain("Send invitation");
    });

    test("is noindex", async () => {
      const owner = await setupOwner();
      const html = await (
        await organisations.index(getPage(owner.sessionId))
      ).text();

      expect(html).toContain('name="robots" content="noindex, nofollow"');
    });

    test("does not offer the invite form to a plain member", async () => {
      const owner = await setupOwner();
      const member = await signUpIntoOrganisation(
        randomEmail(),
        owner.organisation.id,
      );
      if (!member.success) throw new Error("setup failed");

      const sessionId = await createAuthenticatedSession(member.user.id);
      const html = await (await organisations.index(getPage(sessionId))).text();

      expect(html).not.toContain("Send invitation");
      expect(html).toContain("Only an owner can invite");
    });

    test("does not show another organisation's members", async () => {
      const owner = await setupOwner("Acme");
      const other = await setupOwner("Other");

      const html = await (
        await organisations.index(getPage(owner.sessionId))
      ).text();

      expect(html).not.toContain(other.user.email);
    });
  });

  describe("POST /organisation/invites", () => {
    test("creates the invite and sends the email", async () => {
      const owner = await setupOwner("Acme");
      const invitee = randomEmail();

      const response = await organisations.invite(
        await postInvite(owner.sessionId, { email: invitee }),
      );

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/organisation");

      const rows = await db`SELECT email FROM organisation_invites`;
      expect(rows).toHaveLength(1);
      expect(rows[0].email).toBe(invitee.toLowerCase());

      expect(sentInvites).toHaveLength(1);
      expect(sentInvites[0].to).toBe(invitee.toLowerCase());
      expect(sentInvites[0].organisationName).toBe("Acme");
    });

    test("rejects a request with no CSRF token", async () => {
      const owner = await setupOwner();

      const response = await organisations.invite(
        await postInvite(owner.sessionId, { email: randomEmail() }, false),
      );

      expect(response.status).toBe(403);
      expect(await db`SELECT id FROM organisation_invites`).toHaveLength(0);
    });

    test("refuses a plain member", async () => {
      const owner = await setupOwner();
      const member = await signUpIntoOrganisation(
        randomEmail(),
        owner.organisation.id,
      );
      if (!member.success) throw new Error("setup failed");

      const sessionId = await createAuthenticatedSession(member.user.id);
      await organisations.invite(
        await postInvite(sessionId, { email: randomEmail() }),
      );

      expect(await db`SELECT id FROM organisation_invites`).toHaveLength(0);
      expect(sentInvites).toHaveLength(0);
    });

    test("rejects an invalid address", async () => {
      const owner = await setupOwner();

      await organisations.invite(
        await postInvite(owner.sessionId, { email: "nope" }),
      );

      expect(await db`SELECT id FROM organisation_invites`).toHaveLength(0);
    });

    test("refuses to invite someone already in the organisation", async () => {
      const owner = await setupOwner();

      await organisations.invite(
        await postInvite(owner.sessionId, { email: owner.user.email }),
      );

      expect(await db`SELECT id FROM organisation_invites`).toHaveLength(0);
      expect(sentInvites).toHaveLength(0);
    });

    test("keeps the invite when the email fails to send", async () => {
      mock.module("../../services/email", () => ({
        getEmailService: () => ({
          sendOrganisationInvite: async () => {
            throw new Error("smtp down");
          },
        }),
      }));

      const owner = await setupOwner();
      const response = await organisations.invite(
        await postInvite(owner.sessionId, { email: randomEmail() }),
      );

      expect(response.status).toBe(303);
      expect(await db`SELECT id FROM organisation_invites`).toHaveLength(1);
    });
  });

  describe("POST /organisation/invites/:id/delete", () => {
    test("revokes the invite", async () => {
      const owner = await setupOwner();
      const invite = await createInvite(
        owner.organisation.id,
        randomEmail(),
        owner.user.id,
      );
      if (!invite.success) throw new Error("setup failed");

      const response = await organisations.revokeInvite(
        await postRevoke(owner.sessionId, invite.invite.id),
      );

      expect(response.status).toBe(303);
      expect(await db`SELECT id FROM organisation_invites`).toHaveLength(0);
    });

    test("cannot revoke an invite belonging to another organisation", async () => {
      const owner = await setupOwner("Acme");
      const other = await setupOwner("Other");

      const invite = await createInvite(
        other.organisation.id,
        randomEmail(),
        other.user.id,
      );
      if (!invite.success) throw new Error("setup failed");

      await organisations.revokeInvite(
        await postRevoke(owner.sessionId, invite.invite.id),
      );

      expect(await db`SELECT id FROM organisation_invites`).toHaveLength(1);
    });
  });
});
