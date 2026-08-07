import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import { SQL } from "bun";
import { redirectIfAuthenticated } from "../../middleware/auth";
import { clearRateLimitLog } from "../../middleware/rate-limit";
import {
  clearUsedChallenges,
  HONEYPOT_FIELD,
  issueChallenge,
} from "../../services/captcha";
import type { LoginState } from "../../templates/login";
import { createBunRequest, findSetCookie } from "../../test-utils/bun-request";
import { cleanupTestData } from "../../test-utils/helpers";
import { stateHelpers } from "../../utils/state";

// Snapshot the real function value now. `redirectIfAuthenticated` is a live
// binding, so once a test mock.module()s the auth middleware the import itself
// points at the stub — capturing it here keeps a handle on the genuine one.
const realRedirectIfAuthenticated = redirectIfAuthenticated;

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
import { db } from "../../services/database";
import { signUpWithPassword } from "../../services/passwords";
import {
  createAuthenticatedSession,
  createGuestSession,
  getSessionContextFromDB,
} from "../../services/sessions";
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

    test("redirects authenticated user to home", async () => {
      // Mock the redirectIfAuthenticated function to return a redirect response
      const mockRedirectIfAuthenticated = mock(
        () =>
          new Response("", {
            status: 303,
            headers: { Location: "/" },
          }),
      );

      // Temporarily mock the auth middleware
      mock.module("../../middleware/auth", () => ({
        redirectIfAuthenticated: mockRedirectIfAuthenticated,
      }));

      // Re-import login after mocking
      const { login: mockedLogin } = await import("./login");

      const request = createBunRequest("http://localhost:3000/login", {
        method: "GET",
        headers: {
          cookie: "session_id=valid-session-id",
        },
      });

      try {
        const response = await mockedLogin.index(request);

        expect(response.status).toBe(303);
        expect(response.headers.get("location")).toBe("/");
        expect(mockRedirectIfAuthenticated).toHaveBeenCalled();
      } finally {
        // Restore the real middleware so this module mock doesn't leak into
        // other test files when the whole suite runs in one process.
        mock.module("../../middleware/auth", () => ({
          redirectIfAuthenticated: realRedirectIfAuthenticated,
        }));
      }
    });
  });

  describe("POST /login", () => {
    test("creates magic link for valid email", async () => {
      const formData = new FormData();
      formData.append("email", "test@example.com");

      const request = createBunRequest("http://localhost:3000/login", {
        method: "POST",
        body: formData,
      });

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

      const request = createBunRequest("http://localhost:3000/login", {
        method: "POST",
        body: formData,
      });

      await login.create(request);

      // Verify user was created with lowercase email
      const users =
        await db`SELECT email FROM users WHERE email = 'test@example.com'`;
      expect(users).toHaveLength(1);
    });

    test("redirects with error for invalid email", async () => {
      const formData = new FormData();
      formData.append("email", "not-an-email");

      const request = createBunRequest("http://localhost:3000/login", {
        method: "POST",
        body: formData,
      });

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

      const request = createBunRequest("http://localhost:3000/login", {
        method: "POST",
        body: formData,
      });

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

      const request = createBunRequest("http://localhost:3000/login", {
        method: "POST",
        body: formData,
      });

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

  describe("POST /login bot defense", () => {
    test("silently discards a submission with the honeypot filled", async () => {
      const formData = new FormData();
      formData.append("email", "bot@example.com");
      formData.append(HONEYPOT_FIELD, "http://spam.example");

      const request = createBunRequest("http://localhost:3000/login", {
        method: "POST",
        body: formData,
      });

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
      const send = () => {
        const formData = new FormData();
        formData.append("email", "flood@example.com");
        return login.create(
          createBunRequest("http://localhost:3000/login", {
            method: "POST",
            body: formData,
          }),
        );
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

        const request = createBunRequest("http://localhost:3000/login", {
          method: "POST",
          body: formData,
        });

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

        const request = createBunRequest("http://localhost:3000/login", {
          method: "POST",
          body: formData,
        });

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

    const post = (fields: Record<string, string>) => {
      const formData = new FormData();
      for (const [key, value] of Object.entries(fields)) {
        formData.append(key, value);
      }
      return createBunRequest("http://localhost:3000/login", {
        method: "POST",
        body: formData,
      });
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

      const request = post({ email: "member@example.com", password: PASSWORD });
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
        post({ email: "notoken@example.com", password: PASSWORD }),
      );

      const tokens = await db`
        SELECT id FROM user_tokens
        WHERE user_id = ${signUp.user.id} AND type = 'magic_link'
      `;
      expect(tokens).toHaveLength(0);
    });

    test("gives the same message for a wrong password and an unknown account", async () => {
      await signUpWithPassword("known@example.com", PASSWORD);

      const wrongPassword = post({
        email: "known@example.com",
        password: "definitely-not-it",
      });
      await login.create(wrongPassword);

      const unknownAccount = post({
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

    test("refuses a magic-link account that has no password", async () => {
      await findOrCreateUser("linkonly@example.com");

      const request = post({
        email: "linkonly@example.com",
        password: PASSWORD,
      });
      await login.create(request);

      expect(findSetCookie(request, "flash_state")).toContain(
        "Invalid email or password",
      );
      expect(findSetCookie(request, "session_id")).toBeUndefined();
    });

    test("preserves the typed email but never the password", async () => {
      const request = post({
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
      const request = createBunRequest("http://localhost:3000/login", {
        method: "POST",
        headers: { cookie: `session_id=${guestSessionId}` },
        body: (() => {
          const formData = new FormData();
          formData.append("email", "fixation@example.com");
          formData.append("password", PASSWORD);
          return formData;
        })(),
      });

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
      const request = createBunRequest("http://localhost:3000/login", {
        method: "POST",
        headers: { cookie: `session_id=${oldSessionId}` },
        body: (() => {
          const formData = new FormData();
          formData.append("email", "again@example.com");
          formData.append("password", PASSWORD);
          return formData;
        })(),
      });

      await login.create(request);

      expect(await getSessionContextFromDB(oldSessionId)).toBeNull();
      expect(await db`SELECT id_hash FROM sessions`).toHaveLength(1);
    });

    // Password mode has no "check your email" state, so the feign borrows the
    // transient-failure message instead of claiming a magic link was sent to an
    // app that doesn't have them.
    test("feigns a transient failure rather than a magic link on the honeypot", async () => {
      const trapped = post({
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
      const trapped = post({
        email: "bot@example.com",
        password: PASSWORD,
        [HONEYPOT_FIELD]: "http://spam.example",
      });
      expect((await login.create(trapped)).status).toBe(303);
      expect(findSetCookie(trapped, "session_id")).toBeUndefined();

      for (let i = 0; i < 5; i++) {
        await login.create(post({ email: "flood@example.com", password: "x" }));
      }
      expect(
        (
          await login.create(
            post({ email: "flood@example.com", password: "x" }),
          )
        ).status,
      ).toBe(429);
    });
  });
});
