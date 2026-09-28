import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import { clearRateLimitLog } from "../../middleware/rate-limit";
import {
  clearUsedChallenges,
  HONEYPOT_FIELD,
  issueChallenge,
} from "../../services/captcha";
import type { LoginState } from "../../templates/login";
import { createBunRequest, findSetCookie } from "../../test-utils/bun-request";
import { testDatabase } from "../../test-utils/database";
import { cleanupTestData } from "../../test-utils/helpers";
import { stateHelpers } from "../../utils/state";

// Solve a challenge the way the client would, for the captcha-enabled tests.
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

const connection = testDatabase();

mock.module("../../services/database", () => ({
  get db() {
    return connection;
  },
}));

import { findOrCreateUser } from "../../services/auth";
import { db } from "../../services/database";
import { signUpWithPassword } from "../../services/passwords";
import {
  createAuthenticatedSession,
  createGuestSession,
  getSessionContextFromDB,
} from "../../services/sessions";
import { authFormPost, staleCsrfToken } from "../../test-utils/auth-form";
import { login } from "./login";

describe("Login Controller", () => {
  beforeEach(async () => {
    await cleanupTestData(db);
    // Guards share process-wide state; reset so tests don't leak into each other.
    clearRateLimitLog();
    clearUsedChallenges();
  });

  afterAll(async () => {
    await connection.end();
    mock.restore();
  });

  describe("GET /login", () => {
    test("renders login page for unauthenticated user", async () => {
      const request = createBunRequest("http://localhost:3000/login", {
        method: "GET",
      });
      const response = await login.index(request);
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/html");
      expect(html).toContain("Sign in to your account");
      expect(html).toContain('name="email"');
      expect(html).toContain("Send magic link");
    });

    test("shows success message when state=email-sent", async () => {
      const request = createBunRequest("http://localhost:3000/login", {
        method: "GET",
      });

      // Set flash cookie before calling the handler
      const { setFlash } = stateHelpers<LoginState>();
      setFlash(request, { state: "email-sent" });

      const response = await login.index(request);
      const html = await response.text();

      expect(html).toContain("Check your email!");
      expect(html).toContain("We've sent you a magic link");
    });

    test("shows error message when error is provided", async () => {
      const request = createBunRequest("http://localhost:3000/login", {
        method: "GET",
      });

      // Set flash cookie before calling the handler
      const { setFlash } = stateHelpers<LoginState>();
      setFlash(request, {
        state: "validation-error",
        error: "Invalid email",
      });

      const response = await login.index(request);
      const html = await response.text();

      expect(html).toContain("Invalid email");
    });

    // /auth/callback and the other single-use-link dead ends redirect here with
    // ?error=; for a while the page dropped it and showed a pristine form.
    test("renders the error a redirect left in the query string", async () => {
      const request = createBunRequest(
        "http://localhost:3000/login?error=Invalid%20or%20expired%20token",
        { method: "GET" },
      );

      const html = await (await login.index(request)).text();

      expect(html).toContain("Invalid or expired token");
    });

    test("prefers flash state over the query string", async () => {
      const request = createBunRequest(
        "http://localhost:3000/login?error=from%20the%20query",
        { method: "GET" },
      );

      const { setFlash } = stateHelpers<LoginState>();
      setFlash(request, { state: "validation-error", error: "from the flash" });

      const html = await (await login.index(request)).text();

      expect(html).toContain("from the flash");
      expect(html).not.toContain("from the query");
    });

    describe("the console magic-link hint", () => {
      const ORIGINAL_PROVIDER = process.env.EMAIL_PROVIDER;

      afterAll(() => {
        if (ORIGINAL_PROVIDER === undefined) delete process.env.EMAIL_PROVIDER;
        else process.env.EMAIL_PROVIDER = ORIGINAL_PROVIDER;
      });

      const sentPage = async () => {
        const request = createBunRequest("http://localhost:3000/login", {
          method: "GET",
        });
        const { setFlash } = stateHelpers<LoginState>();
        setFlash(request, { state: "email-sent" });

        return (await login.index(request)).text();
      };

      test("appears when mail goes to the console", async () => {
        process.env.EMAIL_PROVIDER = "console";

        expect(await sentPage()).toContain("Check the server console");
      });

      // Anywhere else the link really is in an inbox, and the hint points at a
      // terminal the reader has no way to see.
      test("is absent for a real provider", async () => {
        process.env.EMAIL_PROVIDER = "resend";

        expect(await sentPage()).not.toContain("Check the server console");
      });
    });

    test("redirects authenticated user to home", async () => {
      const user = await findOrCreateUser("already-in@example.com");
      const sessionId = await createAuthenticatedSession(user.id);

      const request = createBunRequest("http://localhost:3000/login", {
        method: "GET",
        headers: { cookie: `session_id=${sessionId}` },
      });

      const response = await login.index(request);

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/");
    });

    // The token the form posts binds to this session, so the cookie has to go
    // out with the page. Without it the browser posts a token against nothing.
    test("renders a CSRF field and sets the guest session cookie", async () => {
      const request = createBunRequest("http://localhost:3000/login", {
        method: "GET",
      });

      const html = await (await login.index(request)).text();

      expect(html).toContain('name="_csrf"');
      expect(findSetCookie(request, "session_id")).toBeDefined();

      const sessions = await db`SELECT session_type FROM sessions`;
      expect(sessions).toHaveLength(1);
      expect(sessions[0].session_type).toBe("guest");
    });

    // The old code called the middleware for its redirect and threw the
    // context away — one orphan session row per anonymous page view.
    test("reuses the session it was given rather than minting another", async () => {
      const sessionId = await createGuestSession();

      const request = createBunRequest("http://localhost:3000/login", {
        method: "GET",
        headers: { cookie: `session_id=${sessionId}` },
      });

      await login.index(request);

      expect(await db`SELECT id_hash FROM sessions`).toHaveLength(1);
    });
  });

  describe("POST /login", () => {
    test("creates magic link for valid email", async () => {
      const formData = new FormData();
      formData.append("email", "test@example.com");

      const request = await authFormPost("/login", formData);

      const response = await login.create(request);

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/login");

      const setCookie = findSetCookie(request, "flash_state");
      expect(setCookie).toBeDefined();
      expect(setCookie).toContain("email-sent");

      // Verify user was created
      const users =
        await db`SELECT id, email FROM users WHERE email = 'test@example.com'`;
      expect(users).toHaveLength(1);

      // Verify magic link token was created
      const tokens = await db`
        SELECT id, user_id, type, expires_at
        FROM user_tokens
        WHERE user_id = ${(users[0] as any).id} AND type = 'magic_link'
      `;
      expect(tokens).toHaveLength(1);
    });

    test("normalizes email to lowercase", async () => {
      const formData = new FormData();
      formData.append("email", "Test@Example.COM");

      const request = await authFormPost("/login", formData);

      await login.create(request);

      // Verify user was created with lowercase email
      const users =
        await db`SELECT email FROM users WHERE email = 'test@example.com'`;
      expect(users).toHaveLength(1);
    });

    test("redirects with error for invalid email", async () => {
      const formData = new FormData();
      formData.append("email", "not-an-email");

      const request = await authFormPost("/login", formData);

      const response = await login.create(request);

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/login");

      const setCookie = findSetCookie(request, "flash_state");
      expect(setCookie).toBeDefined();
      expect(setCookie).toContain("validation-error");
      expect(setCookie).toContain("Invalid email address");
    });

    test("redirects with error for missing email", async () => {
      const formData = new FormData();

      const request = await authFormPost("/login", formData);

      const response = await login.create(request);

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/login");

      const setCookie = findSetCookie(request, "flash_state");
      expect(setCookie).toBeDefined();
      expect(setCookie).toContain("validation-error");
      expect(setCookie).toContain("Invalid email address");
    });

    test("reuses existing user for same email", async () => {
      // Create user first using proper UUID
      const { randomUUID } = await import("node:crypto");
      const userId = randomUUID();
      const user = await db`
        INSERT INTO users (id, email) VALUES (${userId}, 'existing@example.com') RETURNING id
      `;

      const formData = new FormData();
      formData.append("email", "existing@example.com");

      const request = await authFormPost("/login", formData);

      await login.create(request);

      // Should still be only one user
      const users =
        await db`SELECT id FROM users WHERE email = 'existing@example.com'`;
      expect(users).toHaveLength(1);
      expect((users[0] as any).id).toBe((user[0] as any).id);

      // But should have created a new token
      const tokens = await db`
        SELECT id FROM user_tokens
        WHERE user_id = ${(user[0] as any).id} AND type = 'magic_link'
      `;
      expect(tokens).toHaveLength(1);
    });
  });

  // A forged POST /login signs the victim into the *attacker's* account, and
  // they carry on working in it. These four cases are the guard against that.
  describe("POST /login CSRF", () => {
    test("refuses a post with no token, creating nothing", async () => {
      const formData = new FormData();
      formData.append("email", "notoken@example.com");

      const response = await login.create(
        await authFormPost("/login", formData, { csrf: false }),
      );

      expect(response.status).toBe(403);
      expect(
        await db`SELECT id FROM users WHERE email = 'notoken@example.com'`,
      ).toHaveLength(0);
    });

    test("refuses a forged token", async () => {
      const formData = new FormData();
      formData.append("email", "forged@example.com");

      const response = await login.create(
        await authFormPost("/login", formData, { csrf: "nonce.notarealtoken" }),
      );

      expect(response.status).toBe(403);
      expect(
        await db`SELECT id FROM users WHERE email = 'forged@example.com'`,
      ).toHaveLength(0);
    });

    // The cross-origin check runs before the token is even looked at, which is
    // the point: a valid token stolen from the page must not travel.
    test("refuses a post from another origin", async () => {
      const formData = new FormData();
      formData.append("email", "crossorigin@example.com");

      const response = await login.create(
        await authFormPost("/login", formData, {
          origin: "https://evil.example",
        }),
      );

      expect(response.status).toBe(403);
      expect(
        await db`SELECT id FROM users WHERE email = 'crossorigin@example.com'`,
      ).toHaveLength(0);
    });

    // An old tab, not an attack: the address survives and the redirect lands
    // on a page that mints a fresh token. The link is still not sent.
    test("recovers from a stale but authentic token", async () => {
      const sessionId = await createGuestSession();
      const formData = new FormData();
      formData.append("email", "staletab@example.com");

      const request = await authFormPost("/login", formData, {
        sessionId,
        csrf: await staleCsrfToken(sessionId, "/login"),
      });
      const response = await login.create(request);

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/login");

      const flash = findSetCookie(request, "flash_state");
      expect(flash).toContain("validation-error");
      expect(decodeURIComponent(flash as string)).toContain(
        "staletab@example.com",
      );

      expect(
        await db`SELECT id FROM users WHERE email = 'staletab@example.com'`,
      ).toHaveLength(0);
    });
  });

  describe("POST /login bot defense", () => {
    test("silently discards a submission with the honeypot filled", async () => {
      const formData = new FormData();
      formData.append("email", "bot@example.com");
      formData.append(HONEYPOT_FIELD, "http://spam.example");

      const request = await authFormPost("/login", formData);

      const response = await login.create(request);

      // Feigns success so the bot gets no signal...
      expect(response.status).toBe(303);
      const setCookie = findSetCookie(request, "flash_state");
      expect(setCookie).toContain("email-sent");

      // ...but creates no user and issues no magic link.
      const users =
        await db`SELECT id FROM users WHERE email = 'bot@example.com'`;
      expect(users).toHaveLength(0);
    });

    test("returns 429 once the per-IP rate limit is exceeded", async () => {
      const send = async () => {
        const formData = new FormData();
        formData.append("email", "flood@example.com");
        return login.create(await authFormPost("/login", formData));
      };

      // Limit is 5 per window; the 6th request is throttled.
      for (let i = 0; i < 5; i++) {
        expect((await send()).status).toBe(303);
      }
      expect((await send()).status).toBe(429);
    });

    describe("with captcha enabled", () => {
      const original = process.env.CAPTCHA_ENABLED;
      const originalDifficulty = process.env.CAPTCHA_DIFFICULTY;

      beforeEach(() => {
        process.env.CAPTCHA_ENABLED = "true";
        process.env.CAPTCHA_DIFFICULTY = "2000";
      });

      afterAll(() => {
        if (original === undefined) delete process.env.CAPTCHA_ENABLED;
        else process.env.CAPTCHA_ENABLED = original;
        if (originalDifficulty === undefined)
          delete process.env.CAPTCHA_DIFFICULTY;
        else process.env.CAPTCHA_DIFFICULTY = originalDifficulty;
      });

      test("rejects a missing or invalid captcha solution", async () => {
        const formData = new FormData();
        formData.append("email", "human@example.com");
        // No captcha_solution field.

        const request = await authFormPost("/login", formData);

        const response = await login.create(request);

        expect(response.status).toBe(303);
        const setCookie = findSetCookie(request, "flash_state");
        expect(setCookie).toContain("validation-error");
        expect(setCookie).toContain("Verification failed");

        const users =
          await db`SELECT id FROM users WHERE email = 'human@example.com'`;
        expect(users).toHaveLength(0);
      });

      test("issues the magic link when the captcha is solved", async () => {
        const formData = new FormData();
        formData.append("email", "human@example.com");
        formData.append("captcha_solution", solveChallenge(issueChallenge()));

        const request = await authFormPost("/login", formData);

        const response = await login.create(request);

        expect(response.status).toBe(303);
        const setCookie = findSetCookie(request, "flash_state");
        expect(setCookie).toContain("email-sent");

        const users =
          await db`SELECT id FROM users WHERE email = 'human@example.com'`;
        expect(users).toHaveLength(1);
      });
    });
  });

  describe("password mode", () => {
    const originalMode = process.env.AUTH_MODE;
    const PASSWORD = "correct-horse-battery";

    beforeEach(() => {
      process.env.AUTH_MODE = "password";
    });

    afterAll(() => {
      if (originalMode === undefined) delete process.env.AUTH_MODE;
      else process.env.AUTH_MODE = originalMode;
    });

    const post = async (
      fields: Record<string, string>,
      options: Parameters<typeof authFormPost>[2] = {},
    ) => {
      const formData = new FormData();
      for (const [key, value] of Object.entries(fields)) {
        formData.append(key, value);
      }
      return authFormPost("/login", formData, options);
    };

    test("GET renders a password field and a reset link", async () => {
      const html = await (
        await login.index(
          createBunRequest("http://localhost:3000/login", { method: "GET" }),
        )
      ).text();

      expect(html).toContain('name="password"');
      expect(html).toContain('autocomplete="current-password"');
      expect(html).toContain("/forgot-password");
      expect(html).not.toContain("Send magic link");
    });

    test("signs the user in and sets a session cookie", async () => {
      const signUp = await signUpWithPassword("member@example.com", PASSWORD);
      expect(signUp.success).toBe(true);

      const request = await post({
        email: "member@example.com",
        password: PASSWORD,
      });
      const response = await login.create(request);

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/");
      expect(findSetCookie(request, "session_id")).toBeDefined();
    });

    test("issues no magic link token on a password sign-in", async () => {
      const signUp = await signUpWithPassword("notoken@example.com", PASSWORD);
      expect(signUp.success).toBe(true);
      if (!signUp.success) return;

      await login.create(
        await post({ email: "notoken@example.com", password: PASSWORD }),
      );

      const tokens = await db`
        SELECT id FROM user_tokens
        WHERE user_id = ${signUp.user.id} AND type = 'magic_link'
      `;
      expect(tokens).toHaveLength(0);
    });

    test("gives the same message for a wrong password and an unknown account", async () => {
      await signUpWithPassword("known@example.com", PASSWORD);

      const wrongPassword = await post({
        email: "known@example.com",
        password: "definitely-not-it",
      });
      await login.create(wrongPassword);

      const unknownAccount = await post({
        email: "stranger@example.com",
        password: PASSWORD,
      });
      await login.create(unknownAccount);

      const first = findSetCookie(wrongPassword, "flash_state");
      const second = findSetCookie(unknownAccount, "flash_state");

      expect(first).toContain("Invalid email or password");
      expect(second).toContain("Invalid email or password");
      expect(findSetCookie(wrongPassword, "session_id")).toBeUndefined();
      expect(findSetCookie(unknownAccount, "session_id")).toBeUndefined();
    });

    test("points a magic-link account with no password at the reset flow", async () => {
      await findOrCreateUser("linkonly@example.com");

      const request = await post({
        email: "linkonly@example.com",
        password: PASSWORD,
      });
      await login.create(request);

      // The deliberate exception to the merged failure message: there is no
      // password to type correctly, so the generic answer is a dead end.
      const flash = decodeURIComponent(
        findSetCookie(request, "flash_state") as string,
      );
      expect(flash).toContain("no-password");
      expect(flash).toContain("created before password sign-in");
      expect(flash).not.toContain("Invalid email or password");
      expect(findSetCookie(request, "session_id")).toBeUndefined();
    });

    test("renders the no-password message with a link to set one", async () => {
      await findOrCreateUser("linkonly@example.com");

      const post_ = await post({
        email: "linkonly@example.com",
        password: PASSWORD,
      });
      await login.create(post_);

      // Carry the flash the controller just set into the next GET — the value
      // only, not the whole Set-Cookie header findSetCookie returns.
      const value = findSetCookie(post_, "flash_state")?.match(
        /flash_state=([^;]+)/,
      )?.[1];
      const get = createBunRequest("http://localhost:3000/login", {
        method: "GET",
        headers: { cookie: `flash_state=${value}` },
      });
      const html = await (await login.index(get)).text();

      expect(html).toContain("created before password sign-in");
      expect(html).toContain(
        'href="/forgot-password?email=linkonly%40example.com"',
      );
      expect(html).toContain("Set your password");
    });

    test("links to a bare /forgot-password when the flash has no email", async () => {
      const request = createBunRequest("http://localhost:3000/login", {
        method: "GET",
      });
      const { setFlash } = stateHelpers<LoginState>();
      setFlash(request, {
        state: "no-password",
        error: "This account was created before password sign-in.",
      });

      const html = await (await login.index(request)).text();

      expect(html).toContain('href="/forgot-password"');
      expect(html).not.toContain("/forgot-password?email=");
    });

    test("keeps the generic message for a wrong password on a real account", async () => {
      await signUpWithPassword("hasone@example.com", PASSWORD);

      const request = await post({
        email: "hasone@example.com",
        password: "definitely-not-it",
      });
      await login.create(request);

      // The leak is scoped to null-hash rows. A registered password account
      // must still be indistinguishable from an unknown address.
      const flash = decodeURIComponent(
        findSetCookie(request, "flash_state") as string,
      );
      expect(flash).toContain("Invalid email or password");
      expect(flash).not.toContain("no-password");
    });

    test("preserves the typed email but never the password", async () => {
      const request = await post({
        email: "retype@example.com",
        password: "wrong-password-here",
      });
      await login.create(request);

      const flash = findSetCookie(request, "flash_state") as string;
      expect(decodeURIComponent(flash)).toContain("retype@example.com");
      expect(decodeURIComponent(flash)).not.toContain("wrong-password-here");
    });

    test("replaces the guest session rather than upgrading it", async () => {
      const signUp = await signUpWithPassword("fixation@example.com", PASSWORD);
      expect(signUp.success).toBe(true);

      const guestSessionId = await createGuestSession();
      const request = await post(
        { email: "fixation@example.com", password: PASSWORD },
        { sessionId: guestSessionId },
      );

      await login.create(request);

      const cookie = findSetCookie(request, "session_id") as string;
      expect(cookie).toBeDefined();
      expect(cookie).not.toContain(guestSessionId);
      expect(await getSessionContextFromDB(guestSessionId)).toBeNull();
    });

    // The cookie is being overwritten regardless, so leaving the old row alive
    // would only leak a session nobody holds any more.
    test("replaces an authenticated session too, leaving no orphan", async () => {
      const signUp = await signUpWithPassword("again@example.com", PASSWORD);
      expect(signUp.success).toBe(true);
      if (!signUp.success) return;

      const oldSessionId = await createAuthenticatedSession(signUp.user.id);
      const request = await post(
        { email: "again@example.com", password: PASSWORD },
        { sessionId: oldSessionId },
      );

      await login.create(request);

      expect(await getSessionContextFromDB(oldSessionId)).toBeNull();
      expect(await db`SELECT id_hash FROM sessions`).toHaveLength(1);
    });

    // Password mode has no "check your email" state, so the feign borrows the
    // transient-failure message instead of claiming a magic link was sent to an
    // app that doesn't have them.
    test("feigns a transient failure rather than a magic link on the honeypot", async () => {
      const trapped = await post({
        email: "bot@example.com",
        password: PASSWORD,
        [HONEYPOT_FIELD]: "http://spam.example",
      });

      await login.create(trapped);

      const flash = findSetCookie(trapped, "flash_state") as string;
      expect(flash).not.toContain("email-sent");
      expect(flash).toContain("Something went wrong");
      expect(flash).not.toContain(PASSWORD);
    });

    test("still enforces the honeypot and the rate limit", async () => {
      const trapped = await post({
        email: "bot@example.com",
        password: PASSWORD,
        [HONEYPOT_FIELD]: "http://spam.example",
      });
      expect((await login.create(trapped)).status).toBe(303);
      expect(findSetCookie(trapped, "session_id")).toBeUndefined();

      for (let i = 0; i < 5; i++) {
        await login.create(
          await post({ email: "flood@example.com", password: "x" }),
        );
      }
      expect(
        (
          await login.create(
            await post({ email: "flood@example.com", password: "x" }),
          )
        ).status,
      ).toBe(429);
    });
  });
});
