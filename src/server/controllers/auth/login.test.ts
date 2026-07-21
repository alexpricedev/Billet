import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import { SQL } from "bun";
import { clearRateLimitLog } from "../../middleware/rate-limit";
import { clearUsedChallenges, issueChallenge } from "../../services/captcha";
import type { LoginState } from "../../templates/login";
import { createBunRequest, findSetCookie } from "../../test-utils/bun-request";
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

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for tests");
}
const connection = new SQL(process.env.DATABASE_URL);

mock.module("../../services/database", () => ({
  get db() {
    return connection;
  },
}));

import { db } from "../../services/database";
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
      expect(html).toContain("We&#x27;ve sent you a magic link");
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

      const response = await mockedLogin.index(request);

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/");
      expect(mockRedirectIfAuthenticated).toHaveBeenCalled();
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
      formData.append("company_website", "http://spam.example");

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
});
