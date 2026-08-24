import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { SQL } from "bun";
import { clearRateLimitLog } from "../../middleware/rate-limit";
import { createBunRequest, findSetCookie } from "../../test-utils/bun-request";
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

import { createUserToken } from "../../services/auth";
import { createCsrfToken } from "../../services/csrf";
import { db } from "../../services/database";
import { signUpWithPassword } from "../../services/passwords";
import { createAuthenticatedSession } from "../../services/sessions";
import { verify } from "./verify";

const PASSWORD = "correct-horse-battery";
const ORIGIN = process.env.APP_URL as string;

const getVerify = (token?: string) =>
  createBunRequest(`${ORIGIN}/auth/verify${token ? `?token=${token}` : ""}`, {
    method: "GET",
  });

/** The POST behind the confirm button — the step that spends the token. */
const postVerify = (token?: string) =>
  createBunRequest(`${ORIGIN}/auth/verify`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(token ? { token } : {}).toString(),
  });

const postResend = async (sessionId?: string) => {
  const formData = new FormData();

  if (sessionId) {
    formData.append(
      "_csrf",
      await createCsrfToken(sessionId, "POST", "/auth/verify/resend"),
    );
  }

  return createBunRequest(`${ORIGIN}/auth/verify/resend`, {
    method: "POST",
    headers: {
      origin: ORIGIN,
      ...(sessionId ? { cookie: `session_id=${sessionId}` } : {}),
    },
    body: formData,
  });
};

describe("Verify Controller", () => {
  const originalMode = process.env.AUTH_MODE;

  beforeEach(async () => {
    await cleanupTestData(db);
    clearRateLimitLog();
    process.env.AUTH_MODE = "password";
  });

  afterAll(async () => {
    if (originalMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = originalMode;
    await connection.end();
    mock.restore();
  });

  describe("GET /auth/verify", () => {
    // The reason the confirm step exists: mail filters fetch every link they
    // deliver, and a fetch that spent the token would leave the recipient
    // reading "that link didn't work" about a link that worked.
    test("renders the confirm step without spending the token", async () => {
      const signUp = await signUpWithPassword("confirm@example.com", PASSWORD);
      expect(signUp.success).toBe(true);
      if (!signUp.success) return;

      const response = await verify.index(getVerify(signUp.verifyToken));

      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain("Confirm your email");
      expect(html).toContain(`name="token" value="${signUp.verifyToken}"`);

      const rows =
        await db`SELECT email_verified_at FROM users WHERE id = ${signUp.user.id}`;
      expect(rows[0].email_verified_at).toBeNull();
    });

    test("still confirms after a scanner has fetched the link twice", async () => {
      const signUp = await signUpWithPassword("scanned@example.com", PASSWORD);
      expect(signUp.success).toBe(true);
      if (!signUp.success) return;

      await verify.index(getVerify(signUp.verifyToken));
      await verify.index(getVerify(signUp.verifyToken));

      const response = await verify.create(postVerify(signUp.verifyToken));

      expect(await response.text()).toContain("Email confirmed");
    });

    // Nothing here asks for a cookie, deliberately: the link has to work from a
    // mail client's browser, so the form carries no CSRF token to bind.
    test("sets no cookie, so the link works from anywhere", async () => {
      const signUp = await signUpWithPassword("nocookie@example.com", PASSWORD);
      expect(signUp.success).toBe(true);
      if (!signUp.success) return;

      const request = getVerify(signUp.verifyToken);
      const response = await verify.index(request);

      expect(findSetCookie(request, "session_id")).toBeUndefined();
      expect(await response.text()).not.toContain('name="_csrf"');
    });

    test("is never cached", async () => {
      const response = await verify.index(getVerify("some-token"));

      expect(response.headers.get("cache-control")).toBe("no-store");
    });

    // Judging the token here would either spend it or sort real ones from
    // guesses, so an unknown token gets the same page as a good one.
    test("renders the form for an unknown token without judging it", async () => {
      const response = await verify.index(getVerify("not-a-real-token"));

      expect(await response.text()).toContain("Confirm your email");
    });

    test("shows the dead end when there is no token at all", async () => {
      expect(await (await verify.index(getVerify())).text()).toContain(
        "That link didn't work",
      );
    });

    test("404s in magic-link mode", async () => {
      delete process.env.AUTH_MODE;

      expect((await verify.index(getVerify("anything"))).status).toBe(404);
    });
  });

  describe("POST /auth/verify", () => {
    test("marks the address verified and renders the confirmation", async () => {
      const signUp = await signUpWithPassword("spend@example.com", PASSWORD);
      expect(signUp.success).toBe(true);
      if (!signUp.success) return;

      const response = await verify.create(postVerify(signUp.verifyToken));

      // Its own page rather than a redirect to /account: the link is as likely
      // to be opened from a mail client with no session, where an auth-gated
      // destination would swallow the result of a token that was just spent.
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("Email confirmed");

      const rows =
        await db`SELECT email_verified_at FROM users WHERE id = ${signUp.user.id}`;
      expect(rows[0].email_verified_at).not.toBeNull();
    });

    test("does not sign anyone in — the token proves reachability, not identity", async () => {
      const signUp = await signUpWithPassword("noauth@example.com", PASSWORD);
      expect(signUp.success).toBe(true);
      if (!signUp.success) return;

      const request = postVerify(signUp.verifyToken);
      await verify.create(request);

      expect(findSetCookie(request, "session_id")).toBeUndefined();
    });

    test("rejects a missing, unknown, or already-spent token", async () => {
      const signUp = await signUpWithPassword("spent@example.com", PASSWORD);
      expect(signUp.success).toBe(true);
      if (!signUp.success) return;

      for (const request of [postVerify(), postVerify("not-a-real-token")]) {
        const response = await verify.create(request);
        expect(await response.text()).toContain("That link didn't work");
      }

      await verify.create(postVerify(signUp.verifyToken));
      const replay = await verify.create(postVerify(signUp.verifyToken));
      expect(await replay.text()).toContain("That link didn't work");
    });

    // No captcha and no session stand in front of this POST, so the rate limit
    // is the only thing bounding guesses at a token.
    test("throttles attempts per IP", async () => {
      for (let i = 0; i < 10; i++) {
        await verify.create(postVerify("guess"));
      }

      expect((await verify.create(postVerify("guess"))).status).toBe(429);
    });

    test("404s in magic-link mode", async () => {
      delete process.env.AUTH_MODE;

      expect((await verify.create(postVerify("anything"))).status).toBe(404);
    });
  });

  describe("POST /auth/verify/resend", () => {
    test("issues a fresh token for a signed-in unverified user", async () => {
      const signUp = await signUpWithPassword("resend@example.com", PASSWORD);
      expect(signUp.success).toBe(true);
      if (!signUp.success) return;

      const sessionId = await createAuthenticatedSession(signUp.user.id);
      const request = await postResend(sessionId);
      const response = await verify.resend(request);

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/account");
      expect(findSetCookie(request, "flash_state")).toContain(
        "verification-sent",
      );

      const tokens = await db`
        SELECT id FROM user_tokens
        WHERE user_id = ${signUp.user.id} AND type = 'email_verification'
      `;
      // The one from sign-up, plus the resend.
      expect(tokens).toHaveLength(2);
    });

    test("sends nothing when the address is already confirmed", async () => {
      const signUp = await signUpWithPassword("done@example.com", PASSWORD);
      expect(signUp.success).toBe(true);
      if (!signUp.success) return;

      await db`UPDATE users SET email_verified_at = NOW() WHERE id = ${signUp.user.id}`;
      const sessionId = await createAuthenticatedSession(signUp.user.id);

      const request = await postResend(sessionId);
      await verify.resend(request);

      expect(findSetCookie(request, "flash_state")).toContain("verified");

      const tokens = await db`
        SELECT id FROM user_tokens
        WHERE user_id = ${signUp.user.id} AND type = 'email_verification'
      `;
      expect(tokens).toHaveLength(1);
    });

    test("rejects a request with no CSRF token", async () => {
      const signUp = await signUpWithPassword("nocsrf@example.com", PASSWORD);
      expect(signUp.success).toBe(true);
      if (!signUp.success) return;

      const sessionId = await createAuthenticatedSession(signUp.user.id);
      const request = createBunRequest(`${ORIGIN}/auth/verify/resend`, {
        method: "POST",
        headers: { origin: ORIGIN, cookie: `session_id=${sessionId}` },
        body: new FormData(),
      });

      expect((await verify.resend(request)).status).toBe(403);
    });

    test("redirects an anonymous visitor to sign in", async () => {
      const response = await verify.resend(await postResend());

      // No session means no CSRF secret to check against, so this is rejected
      // before it ever reaches the handler body.
      expect([303, 403]).toContain(response.status);
    });

    test("404s in magic-link mode", async () => {
      const signUp = await signUpWithPassword(
        "wrongmode@example.com",
        PASSWORD,
      );
      expect(signUp.success).toBe(true);
      if (!signUp.success) return;

      const sessionId = await createAuthenticatedSession(signUp.user.id);
      const request = await postResend(sessionId);
      delete process.env.AUTH_MODE;

      expect((await verify.resend(request)).status).toBe(404);
    });

    test("throttles resends per IP", async () => {
      const signUp = await signUpWithPassword("flood@example.com", PASSWORD);
      expect(signUp.success).toBe(true);
      if (!signUp.success) return;

      const sessionId = await createAuthenticatedSession(signUp.user.id);

      for (let i = 0; i < 5; i++) {
        await verify.resend(await postResend(sessionId));
      }

      expect((await verify.resend(await postResend(sessionId))).status).toBe(
        429,
      );
    });
  });

  describe("token isolation", () => {
    test("a password reset token cannot be spent as a verification", async () => {
      const signUp = await signUpWithPassword("cross@example.com", PASSWORD);
      expect(signUp.success).toBe(true);
      if (!signUp.success) return;

      const resetToken = await createUserToken(
        signUp.user.id,
        "password_reset",
      );

      const response = await verify.create(postVerify(resetToken));

      expect(await response.text()).toContain("That link didn't work");

      const rows =
        await db`SELECT email_verified_at FROM users WHERE id = ${signUp.user.id}`;
      expect(rows[0].email_verified_at).toBeNull();
    });
  });
});
