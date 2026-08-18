import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { SQL } from "bun";
import { clearRateLimitLog } from "../../middleware/rate-limit";
import { clearUsedChallenges, HONEYPOT_FIELD } from "../../services/captcha";
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

import { findOrCreateUser } from "../../services/auth";
import { db } from "../../services/database";
import { createGuestSession } from "../../services/sessions";
import { signup } from "./signup";

const PASSWORD = "correct-horse-battery";

const post = (fields: Record<string, string>, cookie?: string) => {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.append(key, value);
  }
  return createBunRequest("http://localhost:3000/signup", {
    method: "POST",
    ...(cookie ? { headers: { cookie } } : {}),
    body: formData,
  });
};

const get = () =>
  createBunRequest("http://localhost:3000/signup", { method: "GET" });

describe("Signup Controller", () => {
  beforeEach(async () => {
    await cleanupTestData(db);
    clearRateLimitLog();
    clearUsedChallenges();
  });

  afterAll(async () => {
    await connection.end();
    mock.restore();
  });

  describe("magic-link mode", () => {
    const originalMode = process.env.AUTH_MODE;

    beforeEach(() => {
      delete process.env.AUTH_MODE;
    });

    afterAll(() => {
      if (originalMode === undefined) delete process.env.AUTH_MODE;
      else process.env.AUTH_MODE = originalMode;
    });

    test("renders sign-up wording with no password field", async () => {
      const html = await (await signup.index(get())).text();

      expect(html).toContain("Create your account");
      expect(html).toContain("Send sign-up link");
      expect(html).not.toContain('name="password"');
    });

    test("is noindex and links back to sign-in", async () => {
      const html = await (await signup.index(get())).text();

      expect(html).toContain('name="robots" content="noindex, nofollow"');
      expect(html).toContain('href="/login"');
    });

    test("creates the user and a magic link token", async () => {
      const request = post({ email: "joiner@example.com" });
      const response = await signup.create(request);

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/signup");
      expect(findSetCookie(request, "flash_state")).toContain("email-sent");

      const users =
        await db`SELECT id FROM users WHERE email = 'joiner@example.com'`;
      expect(users).toHaveLength(1);

      const tokens = await db`
        SELECT type FROM user_tokens WHERE user_id = ${users[0].id}
      `;
      expect(tokens).toHaveLength(1);
      expect(tokens[0].type).toBe("magic_link");
    });

    test("does not sign the user in before they click the link", async () => {
      const request = post({ email: "notyet@example.com" });
      await signup.create(request);

      expect(findSetCookie(request, "session_id")).toBeUndefined();
    });

    test("rejects an invalid email", async () => {
      const request = post({ email: "nope" });
      await signup.create(request);

      expect(findSetCookie(request, "flash_state")).toContain(
        "Invalid email address",
      );
      expect(await db`SELECT id FROM users`).toHaveLength(0);
    });
  });

  describe("password mode", () => {
    const originalMode = process.env.AUTH_MODE;

    beforeEach(() => {
      process.env.AUTH_MODE = "password";
    });

    afterAll(() => {
      if (originalMode === undefined) delete process.env.AUTH_MODE;
      else process.env.AUTH_MODE = originalMode;
    });

    test("renders a new-password field with the minimum length", async () => {
      const html = await (await signup.index(get())).text();

      expect(html).toContain('name="password"');
      expect(html).toContain('autocomplete="new-password"');
      expect(html).toContain('minlength="8"');
      expect(html).toContain("Create account");
    });

    // Claiming a link was sent would strand a human who tripped the honeypot at
    // a sign-in for an account that was never created.
    test("feigns a transient failure rather than a sent link on the honeypot", async () => {
      const trapped = post({
        email: "bot@example.com",
        password: PASSWORD,
        [HONEYPOT_FIELD]: "http://spam.example",
      });

      await signup.create(trapped);

      const flash = findSetCookie(trapped, "flash_state") as string;
      expect(flash).not.toContain("email-sent");
      expect(flash).toContain("Something went wrong");
      expect(flash).not.toContain(PASSWORD);
      expect(await db`SELECT id FROM users`).toHaveLength(0);
    });

    test("creates the account and signs the user straight in", async () => {
      const request = post({ email: "fresh@example.com", password: PASSWORD });
      const response = await signup.create(request);

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/");
      expect(findSetCookie(request, "session_id")).toBeDefined();

      // No cookie arrived, so nothing needed replacing — the sign-in must not
      // have created a throwaway guest session on the way.
      expect(await db`SELECT id_hash FROM sessions`).toHaveLength(1);

      const users =
        await db`SELECT id, password_hash, email_verified_at FROM users WHERE email = 'fresh@example.com'`;
      expect(users).toHaveLength(1);
      expect(users[0].password_hash).toStartWith("$argon2id$");
      // Signed in, but not yet proven to own the address — the banner nags.
      expect(users[0].email_verified_at).toBeNull();
    });

    test("issues an email_verification token, not a magic link", async () => {
      await signup.create(
        post({ email: "token@example.com", password: PASSWORD }),
      );

      const users =
        await db`SELECT id FROM users WHERE email = 'token@example.com'`;
      const tokens = await db`
        SELECT type FROM user_tokens WHERE user_id = ${users[0].id}
      `;

      expect(tokens).toHaveLength(1);
      expect(tokens[0].type).toBe("email_verification");
    });

    test("replaces a guest session rather than reusing it", async () => {
      const guestSessionId = await createGuestSession();
      const request = post(
        { email: "guest@example.com", password: PASSWORD },
        `session_id=${guestSessionId}`,
      );

      await signup.create(request);

      const cookie = findSetCookie(request, "session_id") as string;
      expect(cookie).toBeDefined();
      expect(cookie).not.toContain(guestSessionId);
    });

    test("rejects a too-short password without creating anything", async () => {
      const request = post({ email: "weak@example.com", password: "short" });
      await signup.create(request);

      expect(findSetCookie(request, "flash_state")).toContain(
        "at least 8 characters",
      );
      expect(findSetCookie(request, "session_id")).toBeUndefined();
      expect(await db`SELECT id FROM users`).toHaveLength(0);
    });

    test("tells the visitor when the address is already registered", async () => {
      await findOrCreateUser("taken@example.com");

      const request = post({ email: "taken@example.com", password: PASSWORD });
      await signup.create(request);

      expect(
        decodeURIComponent(findSetCookie(request, "flash_state") as string),
      ).toContain("already exists");
      expect(findSetCookie(request, "session_id")).toBeUndefined();
    });

    test("preserves the typed email but never the password", async () => {
      const request = post({ email: "retype@example.com", password: "short" });
      await signup.create(request);

      const flash = decodeURIComponent(
        findSetCookie(request, "flash_state") as string,
      );
      expect(flash).toContain("retype@example.com");
      expect(flash).not.toContain("short");
    });
  });

  describe("bot defense", () => {
    test("feigns success and creates nothing when the honeypot is filled", async () => {
      const request = post({
        email: "bot@example.com",
        [HONEYPOT_FIELD]: "http://spam.example",
      });

      const response = await signup.create(request);

      expect(response.status).toBe(303);
      expect(findSetCookie(request, "flash_state")).toContain("email-sent");
      expect(await db`SELECT id FROM users`).toHaveLength(0);
    });

    test("returns 429 once the per-IP rate limit is exceeded", async () => {
      for (let i = 0; i < 5; i++) {
        await signup.create(post({ email: "flood@example.com" }));
      }

      expect(
        (await signup.create(post({ email: "flood@example.com" }))).status,
      ).toBe(429);
    });
  });

  describe("organisations enabled", () => {
    const originalOrgs = process.env.ORGANISATIONS_ENABLED;
    const originalMode = process.env.AUTH_MODE;

    beforeEach(() => {
      process.env.ORGANISATIONS_ENABLED = "true";
      delete process.env.AUTH_MODE;
    });

    afterAll(() => {
      if (originalOrgs === undefined) delete process.env.ORGANISATIONS_ENABLED;
      else process.env.ORGANISATIONS_ENABLED = originalOrgs;
      if (originalMode === undefined) delete process.env.AUTH_MODE;
      else process.env.AUTH_MODE = originalMode;
    });

    const membershipFor = async (email: string) => {
      const rows = await db`
        SELECT o.name, m.role
        FROM organisation_members m
        JOIN organisations o ON o.id = m.organisation_id
        JOIN users u ON u.id = m.user_id
        WHERE u.email = ${email}
      `;
      return rows[0];
    };

    test("asks for an organisation name", async () => {
      const html = await (await signup.index(get())).text();

      expect(html).toContain('name="organisationName"');
      expect(html).toContain("Organisation name");
    });

    test("does not ask for one when the flag is off", async () => {
      delete process.env.ORGANISATIONS_ENABLED;
      const html = await (await signup.index(get())).text();

      expect(html).not.toContain('name="organisationName"');
    });

    test("creates the organisation and an owner membership (magic-link)", async () => {
      const request = post({
        email: "founder@example.com",
        organisationName: "Acme",
      });
      const response = await signup.create(request);

      expect(response.status).toBe(303);
      expect(findSetCookie(request, "flash_state")).toContain("email-sent");

      const membership = await membershipFor("founder@example.com");
      expect(membership.name).toBe("Acme");
      expect(membership.role).toBe("owner");
    });

    test("creates the organisation and an owner membership (password)", async () => {
      process.env.AUTH_MODE = "password";

      const request = post({
        email: "founder@example.com",
        password: PASSWORD,
        organisationName: "Acme",
      });
      const response = await signup.create(request);

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/");

      const membership = await membershipFor("founder@example.com");
      expect(membership.name).toBe("Acme");
      expect(membership.role).toBe("owner");
    });

    test("rejects a blank organisation name and keeps the email", async () => {
      const request = post({ email: "founder@example.com" });
      await signup.create(request);

      const flash = findSetCookie(request, "flash_state") ?? "";
      expect(decodeURIComponent(flash)).toContain("at least");
      expect(await db`SELECT id FROM users`).toHaveLength(0);
      expect(await db`SELECT id FROM organisations`).toHaveLength(0);
    });

    test("hands the organisation name back after a rejected password", async () => {
      process.env.AUTH_MODE = "password";

      const request = post({
        email: "founder@example.com",
        password: "short",
        organisationName: "Acme",
      });
      await signup.create(request);

      const flash = decodeURIComponent(
        findSetCookie(request, "flash_state") ?? "",
      );
      expect(flash).toContain("Acme");
      expect(await db`SELECT id FROM organisations`).toHaveLength(0);
    });

    test("an existing user gets a link without a second organisation", async () => {
      // Signed up before, so they already belong somewhere.
      await signup.create(
        post({ email: "founder@example.com", organisationName: "Acme" }),
      );
      clearRateLimitLog();

      await signup.create(
        post({ email: "founder@example.com", organisationName: "Second" }),
      );

      expect(await db`SELECT id FROM organisations`).toHaveLength(1);
      const membership = await membershipFor("founder@example.com");
      expect(membership.name).toBe("Acme");
    });

    test("leaves no user behind when the organisation name is rejected", async () => {
      await signup.create(post({ email: "founder@example.com" }));

      expect(await db`SELECT id FROM users`).toHaveLength(0);
    });
  });
});
