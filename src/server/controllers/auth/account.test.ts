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

import { findOrCreateUser } from "../../services/auth";
import { createCsrfToken } from "../../services/csrf";
import { db } from "../../services/database";
import {
  signInWithPassword,
  signUpWithPassword,
} from "../../services/passwords";
import {
  createAuthenticatedSession,
  getSessionContextFromDB,
} from "../../services/sessions";
import { account } from "./account";

const PASSWORD = "correct-horse-battery";
const ORIGIN = process.env.APP_URL as string;

const getAccount = (sessionId?: string) =>
  createBunRequest(`${ORIGIN}/account`, {
    method: "GET",
    ...(sessionId ? { headers: { cookie: `session_id=${sessionId}` } } : {}),
  });

const postPassword = async (
  sessionId: string,
  fields: Record<string, string>,
  withCsrf = true,
) => {
  const formData = new FormData();

  if (withCsrf) {
    formData.append(
      "_csrf",
      await createCsrfToken(sessionId, "POST", "/account/password"),
    );
  }
  for (const [key, value] of Object.entries(fields)) {
    formData.append(key, value);
  }

  return createBunRequest(`${ORIGIN}/account/password`, {
    method: "POST",
    headers: { origin: ORIGIN, cookie: `session_id=${sessionId}` },
    body: formData,
  });
};

describe("Account Controller", () => {
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

  describe("GET /account", () => {
    test("redirects an anonymous visitor to sign in", async () => {
      const response = await account.index(getAccount());

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/login");
    });

    test("shows the email, a resend form, and the change-password form", async () => {
      const signUp = await signUpWithPassword("me@example.com", PASSWORD);
      expect(signUp.success).toBe(true);
      if (!signUp.success) return;

      const sessionId = await createAuthenticatedSession(signUp.user.id);
      const html = await (await account.index(getAccount(sessionId))).text();

      expect(html).toContain("me@example.com");
      expect(html).toContain('action="/auth/verify/resend"');
      expect(html).toContain('action="/account/password"');
      expect(html).toContain("Email and password");
    });

    test("hides the resend form once the address is confirmed", async () => {
      const signUp = await signUpWithPassword("done@example.com", PASSWORD);
      expect(signUp.success).toBe(true);
      if (!signUp.success) return;

      await db`UPDATE users SET email_verified_at = NOW() WHERE id = ${signUp.user.id}`;
      const sessionId = await createAuthenticatedSession(signUp.user.id);
      const html = await (await account.index(getAccount(sessionId))).text();

      expect(html).toContain("Confirmed on");
      expect(html).not.toContain('action="/auth/verify/resend"');
    });

    test("mints a distinct CSRF token per form", async () => {
      const signUp = await signUpWithPassword("tokens@example.com", PASSWORD);
      expect(signUp.success).toBe(true);
      if (!signUp.success) return;

      const sessionId = await createAuthenticatedSession(signUp.user.id);
      const html = await (await account.index(getAccount(sessionId))).text();

      const tokens = [...html.matchAll(/name="_csrf" value="([^"]+)"/g)].map(
        (m) => m[1],
      );
      // Logout, resend, and change-password — tokens are path-bound, so reusing
      // one across forms would fail.
      expect(tokens).toHaveLength(3);
      expect(new Set(tokens).size).toBe(3);
    });

    test("omits the password section in magic-link mode", async () => {
      delete process.env.AUTH_MODE;

      const user = await findOrCreateUser("linkonly@example.com");
      const sessionId = await createAuthenticatedSession(user.id);
      const html = await (await account.index(getAccount(sessionId))).text();

      expect(html).toContain("linkonly@example.com");
      expect(html).toContain("Magic link");
      expect(html).not.toContain('action="/account/password"');
      expect(html).not.toContain("Change password");
    });

    // Every account carried over from magic-link mode lands here with no
    // password, so the page has to offer a way to set a first one.
    test("offers a set-password form to an account with no password", async () => {
      const user = await findOrCreateUser("carried@example.com");
      const sessionId = await createAuthenticatedSession(user.id);
      const html = await (await account.index(getAccount(sessionId))).text();

      expect(html).toContain("Set a password");
      expect(html).toContain('action="/account/password"');
      expect(html).toContain("Email and password (not set yet)");
      expect(html).not.toContain('name="current_password"');
    });

    test("is noindex", async () => {
      const signUp = await signUpWithPassword("hidden@example.com", PASSWORD);
      expect(signUp.success).toBe(true);
      if (!signUp.success) return;

      const sessionId = await createAuthenticatedSession(signUp.user.id);
      const html = await (await account.index(getAccount(sessionId))).text();

      expect(html).toContain('name="robots" content="noindex, nofollow"');
    });
  });

  describe("POST /account/password", () => {
    test("changes the password and keeps the current session", async () => {
      const signUp = await signUpWithPassword("change@example.com", PASSWORD);
      expect(signUp.success).toBe(true);
      if (!signUp.success) return;

      const sessionId = await createAuthenticatedSession(signUp.user.id);
      const request = await postPassword(sessionId, {
        current_password: PASSWORD,
        new_password: "a-brand-new-passphrase",
      });

      const response = await account.updatePassword(request);

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/account");
      expect(findSetCookie(request, "flash_state")).toContain(
        "password-changed",
      );

      expect(await getSessionContextFromDB(sessionId)).not.toBeNull();
      expect(
        await signInWithPassword(
          "change@example.com",
          "a-brand-new-passphrase",
        ),
      ).not.toBeNull();
    });

    test("signs the user out of every other device", async () => {
      const signUp = await signUpWithPassword("evict@example.com", PASSWORD);
      expect(signUp.success).toBe(true);
      if (!signUp.success) return;

      const sessionId = await createAuthenticatedSession(signUp.user.id);
      const otherSessionId = await createAuthenticatedSession(signUp.user.id);

      await account.updatePassword(
        await postPassword(sessionId, {
          current_password: PASSWORD,
          new_password: "a-brand-new-passphrase",
        }),
      );

      expect(await getSessionContextFromDB(otherSessionId)).toBeNull();
    });

    test("rejects a wrong current password", async () => {
      const signUp = await signUpWithPassword("guard@example.com", PASSWORD);
      expect(signUp.success).toBe(true);
      if (!signUp.success) return;

      const sessionId = await createAuthenticatedSession(signUp.user.id);
      const request = await postPassword(sessionId, {
        current_password: "not-the-right-one",
        new_password: "a-brand-new-passphrase",
      });

      await account.updatePassword(request);

      expect(findSetCookie(request, "flash_state")).toContain(
        "isn't your current password",
      );
      expect(
        await signInWithPassword("guard@example.com", PASSWORD),
      ).not.toBeNull();
    });

    test("rejects a too-short new password", async () => {
      const signUp = await signUpWithPassword("weak@example.com", PASSWORD);
      expect(signUp.success).toBe(true);
      if (!signUp.success) return;

      const sessionId = await createAuthenticatedSession(signUp.user.id);
      const request = await postPassword(sessionId, {
        current_password: PASSWORD,
        new_password: "short",
      });

      await account.updatePassword(request);

      expect(findSetCookie(request, "flash_state")).toContain(
        "between 8 and 128",
      );
    });

    test("never writes a password into the flash cookie", async () => {
      const signUp = await signUpWithPassword("leak@example.com", PASSWORD);
      expect(signUp.success).toBe(true);
      if (!signUp.success) return;

      const sessionId = await createAuthenticatedSession(signUp.user.id);
      const request = await postPassword(sessionId, {
        current_password: "wrong-but-memorable",
        new_password: "a-brand-new-passphrase",
      });

      await account.updatePassword(request);

      const flash = findSetCookie(request, "flash_state") as string;
      expect(flash).not.toContain("wrong-but-memorable");
      expect(flash).not.toContain("a-brand-new-passphrase");
    });

    test("sets a first password for an account that has none", async () => {
      const user = await findOrCreateUser("carried@example.com");
      const sessionId = await createAuthenticatedSession(user.id);
      const request = await postPassword(sessionId, {
        new_password: "a-brand-new-passphrase",
      });

      const response = await account.updatePassword(request);

      expect(response.status).toBe(303);
      expect(findSetCookie(request, "flash_state")).toContain("password-set");
      expect(
        await signInWithPassword(
          "carried@example.com",
          "a-brand-new-passphrase",
        ),
      ).not.toBeNull();
    });

    // The whole point of the current-password check: which branch runs is
    // decided by the account's state, so leaving the field out of the form
    // must not be a way past it.
    test("omitting current_password does not bypass it when one is set", async () => {
      const signUp = await signUpWithPassword("bypass@example.com", PASSWORD);
      expect(signUp.success).toBe(true);
      if (!signUp.success) return;

      const sessionId = await createAuthenticatedSession(signUp.user.id);
      const request = await postPassword(sessionId, {
        new_password: "attacker-chosen-passphrase",
      });

      await account.updatePassword(request);

      expect(findSetCookie(request, "flash_state")).toContain("password-error");
      expect(
        await signInWithPassword("bypass@example.com", PASSWORD),
      ).not.toBeNull();
      expect(
        await signInWithPassword(
          "bypass@example.com",
          "attacker-chosen-passphrase",
        ),
      ).toBeNull();
    });

    test("rejects a request with no CSRF token", async () => {
      const signUp = await signUpWithPassword("nocsrf@example.com", PASSWORD);
      expect(signUp.success).toBe(true);
      if (!signUp.success) return;

      const sessionId = await createAuthenticatedSession(signUp.user.id);
      const request = await postPassword(
        sessionId,
        { current_password: PASSWORD, new_password: "a-brand-new-passphrase" },
        false,
      );

      expect((await account.updatePassword(request)).status).toBe(403);
      expect(
        await signInWithPassword("nocsrf@example.com", PASSWORD),
      ).not.toBeNull();
    });

    test("404s in magic-link mode", async () => {
      const signUp = await signUpWithPassword(
        "wrongmode@example.com",
        PASSWORD,
      );
      expect(signUp.success).toBe(true);
      if (!signUp.success) return;

      const sessionId = await createAuthenticatedSession(signUp.user.id);
      const request = await postPassword(sessionId, {
        current_password: PASSWORD,
        new_password: "a-brand-new-passphrase",
      });
      delete process.env.AUTH_MODE;

      expect((await account.updatePassword(request)).status).toBe(404);
    });

    test("throttles attempts per IP", async () => {
      const signUp = await signUpWithPassword("flood@example.com", PASSWORD);
      expect(signUp.success).toBe(true);
      if (!signUp.success) return;

      const sessionId = await createAuthenticatedSession(signUp.user.id);

      for (let i = 0; i < 5; i++) {
        await account.updatePassword(
          await postPassword(sessionId, {
            current_password: "wrong",
            new_password: "a-brand-new-passphrase",
          }),
        );
      }

      const throttled = await account.updatePassword(
        await postPassword(sessionId, {
          current_password: PASSWORD,
          new_password: "a-brand-new-passphrase",
        }),
      );
      expect(throttled.status).toBe(429);
    });
  });
});
