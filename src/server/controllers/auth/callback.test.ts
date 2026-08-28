import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { type BunRequest, SQL } from "bun";
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

const ORIGIN = process.env.APP_URL as string;

const cookieValue = (req: BunRequest, name: string): string => {
  const match = findSetCookie(req, name)?.match(new RegExp(`${name}=([^;]+)`));
  if (!match) throw new Error(`no ${name} cookie was set`);
  return match[1];
};

/** The confirm page the link lands on, plus what it hands the browser. */
const openLink = async (rawToken?: string) => {
  const req = createBunRequest(
    `${ORIGIN}/auth/callback${rawToken ? `?token=${rawToken}` : ""}`,
    { method: "GET" },
  );
  const res = await callback.index(req);
  const html = res.status === 200 ? await res.text() : "";

  return {
    req,
    res,
    html,
    csrfToken: html.match(/name="_csrf" value="([^"]+)"/)?.[1],
  };
};

/** Submitting that page's form — the step that spends the token. */
const submitConfirm = async (opts: {
  token: string;
  csrfToken?: string;
  sessionId?: string;
  origin?: string;
}) => {
  const req = createBunRequest(`${ORIGIN}/auth/callback`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      Origin: opts.origin ?? ORIGIN,
      ...(opts.sessionId ? { cookie: `session_id=${opts.sessionId}` } : {}),
    },
    body: new URLSearchParams({
      _csrf: opts.csrfToken ?? "",
      token: opts.token,
    }).toString(),
  });

  return { req, res: await callback.create(req) };
};

/** The whole journey: open the link, then click the button. */
const signIn = async (rawToken: string) => {
  const opened = await openLink(rawToken);
  const submitted = await submitConfirm({
    token: rawToken,
    csrfToken: opened.csrfToken,
    sessionId: cookieValue(opened.req, "session_id"),
  });

  return { ...submitted, opened };
};

const errorFrom = (res: Response): string =>
  decodeURIComponent(res.headers.get("location") ?? "");

describe("Callback Controller", () => {
  beforeEach(async () => {
    await cleanupTestData(db);
  });

  afterAll(async () => {
    await connection.end();
    mock.restore();
  });

  describe("GET /auth/callback", () => {
    // The reason this page exists: mail filters fetch every link they deliver,
    // and a fetch that spent the token would leave the recipient clicking a
    // link that was already dead. A GET must not touch it.
    test("does not spend the token", async () => {
      const { user, rawToken } = await createMagicLink("scanned@example.com");

      const { res, html } = await openLink(rawToken);

      expect(res.status).toBe(200);
      expect(html).toContain("Confirm sign in");

      const tokens = await db`
        SELECT used_at FROM user_tokens
        WHERE user_id = ${user.id} AND type = 'magic_link'
      `;
      expect(tokens[0].used_at).toBeNull();
    });

    test("still signs in after a scanner has fetched the link twice", async () => {
      const { rawToken } = await createMagicLink("prefetched@example.com");

      await openLink(rawToken);
      await openLink(rawToken);

      const { res } = await signIn(rawToken);

      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe("/");
    });

    test("carries the token and a CSRF field into the form", async () => {
      const { rawToken } = await createMagicLink("form@example.com");

      const { html, csrfToken } = await openLink(rawToken);

      expect(html).toContain(`name="token" value="${rawToken}"`);
      expect(csrfToken).toBeTruthy();
    });

    // The page holds a live sign-in token, and a cached copy would re-present a
    // form whose token has since been spent.
    test("is never cached", async () => {
      const { rawToken } = await createMagicLink("nocache@example.com");

      const { res } = await openLink(rawToken);

      expect(res.headers.get("cache-control")).toBe("no-store");
    });

    // Renders the same page for a token that was never real: checking here
    // would either spend it or sort guesses from the genuine article.
    test("renders the form for an unknown token without judging it", async () => {
      const { res, html } = await openLink("not-a-real-token");

      expect(res.status).toBe(200);
      expect(html).toContain("Confirm sign in");
    });

    test("redirects with error for missing token", async () => {
      const { res } = await openLink();

      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe(
        "/login?error=Missing authentication token",
      );
    });
  });

  describe("POST /auth/callback", () => {
    test("successfully verifies valid magic link token", async () => {
      const { rawToken } = await createMagicLink("test@example.com");

      const { req, res } = await signIn(rawToken);

      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe("/");

      const setCookie = findSetCookie(req, "session_id");
      expect(setCookie).toContain("session_id=");
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("SameSite=Lax");
    });

    test("marks token as used after successful verification", async () => {
      const { user, rawToken } = await createMagicLink("used@example.com");

      await signIn(rawToken);

      const tokens = await db`
        SELECT used_at FROM user_tokens
        WHERE user_id = ${user.id} AND type = 'magic_link'
      `;

      expect(tokens).toHaveLength(1);
      expect(tokens[0].used_at).not.toBeNull();
    });

    test("creates valid session after token verification", async () => {
      const { user, rawToken } = await createMagicLink("session@example.com");

      const { req } = await signIn(rawToken);
      const sessionId = cookieValue(req, "session_id");

      const { computeHMAC } = await import("../../utils/crypto");
      const sessions = await db`
        SELECT user_id, expires_at FROM sessions
        WHERE id_hash = ${computeHMAC(sessionId)}
      `;

      expect(sessions).toHaveLength(1);
      expect(sessions[0].user_id).toBe(user.id);

      const expiresAt = new Date(sessions[0].expires_at as string);
      const diffDays =
        (expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeGreaterThan(29);
      expect(diffDays).toBeLessThan(31);
    });

    // A cross-site auto-submit here would be login CSRF: a visitor dropped into
    // a session, and an account, they never asked for.
    test("rejects a submission with no CSRF token", async () => {
      const { rawToken } = await createMagicLink("nocsrf@example.com");
      const opened = await openLink(rawToken);

      const { res } = await submitConfirm({
        token: rawToken,
        sessionId: cookieValue(opened.req, "session_id"),
      });

      expect(res.status).toBe(403);
    });

    test("rejects a submission from another origin", async () => {
      const { rawToken } = await createMagicLink("crossorigin@example.com");
      const opened = await openLink(rawToken);

      const { res } = await submitConfirm({
        token: rawToken,
        csrfToken: opened.csrfToken,
        sessionId: cookieValue(opened.req, "session_id"),
        origin: "https://evil.example",
      });

      expect(res.status).toBe(403);
    });

    test("leaves the token unspent when the CSRF check fails", async () => {
      const { user, rawToken } = await createMagicLink("survives@example.com");
      const opened = await openLink(rawToken);

      await submitConfirm({
        token: rawToken,
        sessionId: cookieValue(opened.req, "session_id"),
      });

      const tokens = await db`
        SELECT used_at FROM user_tokens
        WHERE user_id = ${user.id} AND type = 'magic_link'
      `;
      expect(tokens[0].used_at).toBeNull();
    });

    test("redirects with error for missing token", async () => {
      const { rawToken } = await createMagicLink("blank@example.com");
      const opened = await openLink(rawToken);

      const { res } = await submitConfirm({
        token: "",
        csrfToken: opened.csrfToken,
        sessionId: cookieValue(opened.req, "session_id"),
      });

      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe(
        "/login?error=Missing authentication token",
      );
    });

    test("redirects with error for invalid token", async () => {
      const opened = await openLink("invalid-token");

      const { res } = await submitConfirm({
        token: "invalid-token",
        csrfToken: opened.csrfToken,
        sessionId: cookieValue(opened.req, "session_id"),
      });

      expect(res.status).toBe(303);
      expect(errorFrom(res)).toContain("Invalid or expired token");
    });

    test("redirects with error for already used token", async () => {
      const { rawToken } = await createMagicLink("reuse@example.com");

      await signIn(rawToken);
      const { res } = await signIn(rawToken);

      expect(res.status).toBe(303);
      expect(errorFrom(res)).toContain("Invalid or expired token");
    });

    test("redirects with error for expired token", async () => {
      const { user, rawToken } = await createMagicLink("expired@example.com");
      const opened = await openLink(rawToken);

      await db`
        UPDATE user_tokens
        SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 hour'
        WHERE user_id = ${user.id} AND type = 'magic_link'
      `;

      const { res } = await submitConfirm({
        token: rawToken,
        csrfToken: opened.csrfToken,
        sessionId: cookieValue(opened.req, "session_id"),
      });

      expect(res.status).toBe(303);
      expect(errorFrom(res)).toContain("expired");
    });

    test("handles database errors gracefully", async () => {
      const { user, rawToken } = await createMagicLink("deleted@example.com");
      const opened = await openLink(rawToken);
      const sessionId = cookieValue(opened.req, "session_id");

      await db`DELETE FROM users WHERE id = ${user.id}`;

      const { res } = await submitConfirm({
        token: rawToken,
        csrfToken: opened.csrfToken,
        sessionId,
      });

      expect(res.status).toBe(303);
      expect(errorFrom(res)).toContain("Invalid or expired token");
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

    const signInAs = async (email: string) => {
      const { user, rawToken } = await createMagicLink(email);
      const { res } = await signIn(rawToken);

      return { user, location: res.headers.get("location") };
    };

    test("sends a user with no team to /team", async () => {
      const { location } = await signInAs("teamless@example.com");

      expect(location).toBe("/team");
    });

    test("sends a user who is already in a team home", async () => {
      const first = await createMagicLink("member@example.com");
      const created = await createOrganizationForUser(first.user.id, "Acme");
      if (!created.success) throw new Error("seed failed");

      const { location } = await signInAs("member@example.com");

      expect(location).toBe("/");
    });
  });
});

// The flag-off case is covered by every other test in this file: run-tests.ts
// pins TEAMS_ENABLED=false, and they all assert "/". That matters more than it
// looks — /team 404s with teams off, so a redirect there would break sign-in
// for every fork that never turned the feature on.
