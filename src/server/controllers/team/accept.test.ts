import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import { clearRateLimitLog } from "../../middleware/rate-limit";
import { testDatabase } from "../../test-utils/database";
import { cleanupTestData } from "../../test-utils/helpers";

const connection = testDatabase();

mock.module("../../services/database", () => ({
  get db() {
    return connection;
  },
}));

import { findOrCreateUser } from "../../services/auth";
import { clearUsedChallenges, issueChallenge } from "../../services/captcha";
import { createCsrfToken } from "../../services/csrf";
import { db } from "../../services/database";
import { createInvite, peekInvite } from "../../services/invites";
import {
  createOrganizationForUser,
  getMembership,
} from "../../services/organizations";
import { signUpWithPassword, userHasPassword } from "../../services/passwords";
import { createAuthenticatedSession } from "../../services/sessions";
import { createBunRequest } from "../../test-utils/bun-request";
import { invite } from "./accept";

const ORIGINAL_TEAMS = process.env.TEAMS_ENABLED;
const ORIGINAL_AUTH = process.env.AUTH_MODE;

beforeEach(async () => {
  process.env.TEAMS_ENABLED = "true";
  process.env.AUTH_MODE = "magic-link";
  // Every case posts to a form guarded by a 5-per-minute per-IP limit, and the
  // whole file shares one (absent) IP.
  clearRateLimitLog();
  await cleanupTestData(db);
});

afterAll(async () => {
  if (ORIGINAL_TEAMS === undefined) delete process.env.TEAMS_ENABLED;
  else process.env.TEAMS_ENABLED = ORIGINAL_TEAMS;

  if (ORIGINAL_AUTH === undefined) delete process.env.AUTH_MODE;
  else process.env.AUTH_MODE = ORIGINAL_AUTH;

  await connection.end();
  mock.restore();
});

// Solve a challenge the way the client would, for the captcha-enabled cases.
const solveChallenge = (
  challenge: ReturnType<typeof issueChallenge>,
): string => {
  let answer = 0;
  for (let n = 0; n <= challenge.maxnumber; n++) {
    if (
      createHash("sha256").update(`${challenge.salt}${n}`).digest("hex") ===
      challenge.challenge
    ) {
      answer = n;
      break;
    }
  }
  return Buffer.from(
    JSON.stringify({
      salt: challenge.salt,
      challenge: challenge.challenge,
      expires: challenge.expires,
      signature: challenge.signature,
      number: answer,
    }),
  ).toString("base64");
};

const seedInvite = async (email = "invitee@example.com") => {
  const owner = await findOrCreateUser("owner@example.com");
  const created = await createOrganizationForUser(owner.id, "Acme");
  if (!created.success) throw new Error("seed failed");

  const result = await createInvite(
    created.organization.id,
    email,
    "member",
    owner.id,
  );
  if (!result.success) throw new Error("invite failed");

  return { owner, org: created.organization, ...result };
};

const getAccept = (token: string, cookie?: string) =>
  createBunRequest(
    `http://localhost:3000/invites/accept?token=${encodeURIComponent(token)}`,
    cookie ? { headers: { cookie } } : {},
  );

const postAccept = (fields: Record<string, string>, cookie?: string) => {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.append(key, value);

  return createBunRequest("http://localhost:3000/invites/accept", {
    method: "POST",
    headers: {
      Origin: "http://localhost:3000",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body,
  });
};

/**
 * Controllers set the session cookie on the request, which the mock records —
 * it never reaches the Response object these tests hold, so asserting on
 * `response.headers` would silently pass for "no cookie set" either way.
 */
const cookiesSetOn = (req: ReturnType<typeof postAccept>): string[] =>
  (req.cookies as unknown as { getSetCookies: () => string[] }).getSetCookies();

const signedInBy = (req: ReturnType<typeof postAccept>): boolean =>
  cookiesSetOn(req).some((cookie) => cookie.startsWith("session_id="));

describe("Invite acceptance", () => {
  test("404s on GET and POST when the flag is off", async () => {
    process.env.TEAMS_ENABLED = "false";
    const seeded = await seedInvite();

    expect((await invite.index(getAccept(seeded.rawToken))).status).toBe(404);
    expect(
      (await invite.create(postAccept({ token: seeded.rawToken }))).status,
    ).toBe(404);
  });

  describe("GET", () => {
    test("names the team without spending the token", async () => {
      const seeded = await seedInvite();

      const response = await invite.index(getAccept(seeded.rawToken));

      expect(response.status).toBe(200);
      expect(await response.text()).toContain("Acme");

      // Still live: a refresh must not cost the invitee their invitation.
      expect(await peekInvite(seeded.rawToken)).not.toBeNull();
    });

    test("shows a dead end for an unknown token", async () => {
      const response = await invite.index(getAccept("nope"));

      expect(response.status).toBe(200);
      expect(await response.text()).toContain("Invitation unavailable");
    });

    // The page a refused POST redirects to. Rendering it rather than
    // redirecting again is what keeps that from pointing at itself.
    test("shows the dead end for no token at all, without redirecting", async () => {
      const response = await invite.index(
        createBunRequest("http://localhost:3000/invites/accept"),
      );

      expect(response.status).toBe(200);
      expect(await response.text()).toContain("Invitation unavailable");
    });

    test("warns when signed in as someone else, and offers a way out", async () => {
      const seeded = await seedInvite();
      const other = await findOrCreateUser("someone@example.com");
      const sessionId = await createAuthenticatedSession(other.id);

      const response = await invite.index(
        getAccept(seeded.rawToken, `session_id=${sessionId}`),
      );

      const html = await response.text();
      expect(html).toContain("someone@example.com");
      expect(html).toContain("Sign out");
      expect(await peekInvite(seeded.rawToken)).not.toBeNull();
    });
  });

  describe("magic-link mode", () => {
    test("joins the org and signs the invitee in", async () => {
      const seeded = await seedInvite();
      const request = postAccept({ token: seeded.rawToken });

      const response = await invite.create(request);

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/");
      expect(signedInBy(request)).toBe(true);

      const joined = await findOrCreateUser("invitee@example.com");
      expect((await getMembership(joined.id))?.org.id).toBe(seeded.org.id);
    });

    test("verifies the address, since the token reached their mailbox", async () => {
      const seeded = await seedInvite();

      await invite.create(postAccept({ token: seeded.rawToken }));

      const rows = await db`
        SELECT email_verified_at FROM users WHERE email = 'invitee@example.com'
      `;
      expect(rows[0].email_verified_at).not.toBeNull();
    });

    test("a spent token cannot be replayed", async () => {
      const seeded = await seedInvite();

      await invite.create(postAccept({ token: seeded.rawToken }));

      const request = postAccept({ token: seeded.rawToken });
      const replay = await invite.create(request);

      expect(replay.status).toBe(303);
      expect(replay.headers.get("location")).toBe("/invites/accept");
      expect(signedInBy(request)).toBe(false);
    });

    test("refuses while signed in as a different user", async () => {
      const seeded = await seedInvite();
      const other = await findOrCreateUser("someone@example.com");
      const sessionId = await createAuthenticatedSession(other.id);

      // A signed-in POST has a session to bind a token to, so the CSRF check
      // applies — supply one, or this asserts the wrong refusal.
      const response = await invite.create(
        postAccept(
          {
            token: seeded.rawToken,
            _csrf: await createCsrfToken(sessionId, "POST", "/invites/accept"),
          },
          `session_id=${sessionId}`,
        ),
      );

      // Back to the link itself, where the GET explains the mismatch and
      // offers a way out — the token is unspent, so it still works.
      expect(response.headers.get("location")).toBe(
        `/invites/accept?token=${encodeURIComponent(seeded.rawToken)}`,
      );
      expect(await getMembership(other.id)).toBeNull();
      expect(await peekInvite(seeded.rawToken)).not.toBeNull();
    });
  });

  describe("password mode", () => {
    beforeEach(() => {
      process.env.AUTH_MODE = "password";
    });

    test("a new invitee sets a password and is signed in", async () => {
      const seeded = await seedInvite();
      const request = postAccept({
        token: seeded.rawToken,
        password: "correct-horse",
      });

      const response = await invite.create(request);

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/");
      expect(signedInBy(request)).toBe(true);

      const joined = await findOrCreateUser("invitee@example.com");
      expect(await userHasPassword(joined.id)).toBe(true);
      expect((await getMembership(joined.id))?.org.id).toBe(seeded.org.id);
    });

    test("a short password is refused and does NOT spend the token", async () => {
      const seeded = await seedInvite();

      const firstRequest = postAccept({
        token: seeded.rawToken,
        password: "short",
      });
      await invite.create(firstRequest);

      expect(signedInBy(firstRequest)).toBe(false);
      expect(await peekInvite(seeded.rawToken)).not.toBeNull();

      // The retry with a good password still works — that's the point.
      const second = await invite.create(
        postAccept({ token: seeded.rawToken, password: "correct-horse" }),
      );
      expect(second.headers.get("location")).toBe("/");
    });

    test("an existing password account joins but is NOT signed in", async () => {
      const seeded = await seedInvite("existing@example.com");
      const signup = await signUpWithPassword(
        "existing@example.com",
        "correct-horse",
      );
      if (!signup.success) throw new Error("signup failed");

      const request = postAccept({ token: seeded.rawToken });
      const response = await invite.create(request);

      // Mailbox control is grounds for a reset, never a sign-in — the same
      // posture /auth/verify takes.
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/login");
      expect(signedInBy(request)).toBe(false);

      expect((await getMembership(signup.user.id))?.org.id).toBe(seeded.org.id);
    });

    test("the accept form asks for a password only when one is needed", async () => {
      const seeded = await seedInvite("existing@example.com");
      const signup = await signUpWithPassword(
        "existing@example.com",
        "correct-horse",
      );
      if (!signup.success) throw new Error("signup failed");
      const sessionId = await createAuthenticatedSession(signup.user.id);

      const response = await invite.index(
        getAccept(seeded.rawToken, `session_id=${sessionId}`),
      );

      const html = await response.text();
      expect(html).toContain("Accept invitation");
      expect(html).not.toContain('type="password"');
    });
  });

  // guardAuthForm verifies a solution on every POST regardless of mode, so the
  // widget has to be on every rendering of the form. Gating it on
  // needsNewPassword as well made magic-link mode — where nobody ever needs a
  // password — unacceptable in its entirety.
  describe("with captcha enabled", () => {
    const ORIGINAL_CAPTCHA = process.env.CAPTCHA_ENABLED;
    const ORIGINAL_DIFFICULTY = process.env.CAPTCHA_DIFFICULTY;

    beforeEach(() => {
      process.env.CAPTCHA_ENABLED = "true";
      process.env.CAPTCHA_DIFFICULTY = "2000";
      clearUsedChallenges();
    });

    afterAll(() => {
      if (ORIGINAL_CAPTCHA === undefined) delete process.env.CAPTCHA_ENABLED;
      else process.env.CAPTCHA_ENABLED = ORIGINAL_CAPTCHA;
      if (ORIGINAL_DIFFICULTY === undefined)
        delete process.env.CAPTCHA_DIFFICULTY;
      else process.env.CAPTCHA_DIFFICULTY = ORIGINAL_DIFFICULTY;
    });

    test("the form carries a challenge in magic-link mode", async () => {
      const seeded = await seedInvite();

      const html = await (
        await invite.index(getAccept(seeded.rawToken))
      ).text();

      expect(html).toContain("captcha");
    });

    test("a solved challenge accepts the invitation", async () => {
      const seeded = await seedInvite();
      const request = postAccept({
        token: seeded.rawToken,
        captcha_solution: solveChallenge(issueChallenge()),
      });

      const response = await invite.create(request);

      expect(response.headers.get("location")).toBe("/");
      const joined = await findOrCreateUser("invitee@example.com");
      expect((await getMembership(joined.id))?.org.id).toBe(seeded.org.id);
    });
  });
});
