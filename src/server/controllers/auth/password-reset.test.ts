import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import { SQL } from "bun";
import { clearRateLimitLog } from "../../middleware/rate-limit";
import {
  CAPTCHA_SOLUTION_FIELD,
  clearUsedChallenges,
  HONEYPOT_FIELD,
  issueChallenge,
} from "../../services/captcha";
import {
  type EmailMessage,
  EmailService,
  setEmailService,
} from "../../services/email";
import { createBunRequest, findSetCookie } from "../../test-utils/bun-request";
import { cleanupTestData } from "../../test-utils/helpers";

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

import { createUserToken } from "../../services/auth";
import { db } from "../../services/database";
import {
  createPasswordReset,
  signInWithPassword,
  signUpWithPassword,
} from "../../services/passwords";
import {
  createAuthenticatedSession,
  getSessionContextFromDB,
} from "../../services/sessions";
import { passwordReset } from "./password-reset";

const PASSWORD = "correct-horse-battery";
const NEW_PASSWORD = "a-brand-new-passphrase";

const getForgot = () =>
  createBunRequest("http://localhost:3000/forgot-password", { method: "GET" });

const postForgot = (fields: Record<string, string>) => {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.append(key, value);
  }
  return createBunRequest("http://localhost:3000/forgot-password", {
    method: "POST",
    body: formData,
  });
};

const getReset = (token?: string) =>
  createBunRequest(
    `http://localhost:3000/reset-password${token ? `?token=${token}` : ""}`,
    { method: "GET" },
  );

const postReset = (fields: Record<string, string>) => {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.append(key, value);
  }
  return createBunRequest("http://localhost:3000/reset-password", {
    method: "POST",
    body: formData,
  });
};

describe("Password Reset Controller", () => {
  const originalMode = process.env.AUTH_MODE;

  beforeEach(async () => {
    await cleanupTestData(db);
    clearRateLimitLog();
    clearUsedChallenges();
    process.env.AUTH_MODE = "password";
  });

  afterAll(async () => {
    if (originalMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = originalMode;
    // Drop the capturing service one test installs, so the singleton rebuilds.
    setEmailService(null as unknown as EmailService);
    await connection.end();
    mock.restore();
  });

  describe("GET /forgot-password", () => {
    test("renders the request form", async () => {
      const html = await (await passwordReset.index(getForgot())).text();

      expect(html).toContain("Reset your password");
      expect(html).toContain('name="email"');
      expect(html).toContain('name="robots" content="noindex, nofollow"');
    });

    test("404s in magic-link mode", async () => {
      delete process.env.AUTH_MODE;

      expect((await passwordReset.index(getForgot())).status).toBe(404);
    });
  });

  describe("POST /forgot-password", () => {
    test("mints a reset token for a registered address", async () => {
      const signUp = await signUpWithPassword("member@example.com", PASSWORD);
      expect(signUp.success).toBe(true);
      if (!signUp.success) return;

      const request = postForgot({ email: "member@example.com" });
      const response = await passwordReset.create(request);

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/forgot-password");
      expect(findSetCookie(request, "flash_state")).toContain("email-sent");

      const tokens = await db`
        SELECT id FROM user_tokens
        WHERE user_id = ${signUp.user.id} AND type = 'password_reset'
      `;
      expect(tokens).toHaveLength(1);
    });

    test("builds the reset link from APP_URL, not the request Host", async () => {
      const signUp = await signUpWithPassword("host@example.com", PASSWORD);
      expect(signUp.success).toBe(true);
      if (!signUp.success) return;

      const sent: EmailMessage[] = [];
      setEmailService(
        new EmailService({
          send: async (message) => {
            sent.push(message);
          },
        }),
      );

      // `new URL(req.url).host` is the client's Host header. A forged one must
      // not reach the email, or the link hands the token to the attacker.
      const formData = new FormData();
      formData.append("email", "host@example.com");
      await passwordReset.create(
        createBunRequest("http://evil.example/forgot-password", {
          method: "POST",
          body: formData,
        }),
      );

      expect(sent).toHaveLength(1);
      expect(sent[0].html).not.toContain("evil.example");
      expect(sent[0].text).not.toContain("evil.example");
      expect(sent[0].html).toContain(
        `${new URL(process.env.APP_URL as string).origin}/reset-password?token=`,
      );
    });

    test("answers an unknown address identically, creating nothing", async () => {
      const known = await signUpWithPassword("known@example.com", PASSWORD);
      expect(known.success).toBe(true);

      const knownRequest = postForgot({ email: "known@example.com" });
      await passwordReset.create(knownRequest);

      const unknownRequest = postForgot({ email: "stranger@example.com" });
      const response = await passwordReset.create(unknownRequest);

      // Same status and same flash: the form can't be used to test whether an
      // address is registered.
      expect(response.status).toBe(303);
      expect(findSetCookie(unknownRequest, "flash_state")).toContain(
        "email-sent",
      );
      expect(findSetCookie(knownRequest, "flash_state")).toContain(
        "email-sent",
      );

      const users =
        await db`SELECT id FROM users WHERE email = 'stranger@example.com'`;
      expect(users).toHaveLength(0);
    });

    test("rejects an invalid email", async () => {
      const request = postForgot({ email: "not-an-email" });
      await passwordReset.create(request);

      expect(findSetCookie(request, "flash_state")).toContain(
        "Invalid email address",
      );
    });

    test("preserves the typed email on a rejected submission", async () => {
      const request = postForgot({ email: "retype.example.com" });
      await passwordReset.create(request);

      // The template renders it back as the field's defaultValue, so nobody
      // retypes their address because a captcha went stale or a typo slipped in.
      expect(
        decodeURIComponent(findSetCookie(request, "flash_state") as string),
      ).toContain("retype.example.com");
    });

    test("feigns success when the honeypot is filled", async () => {
      const signUp = await signUpWithPassword("bait@example.com", PASSWORD);
      expect(signUp.success).toBe(true);
      if (!signUp.success) return;

      const request = postForgot({
        email: "bait@example.com",
        [HONEYPOT_FIELD]: "http://spam.example",
      });
      await passwordReset.create(request);

      expect(findSetCookie(request, "flash_state")).toContain("email-sent");

      const tokens = await db`
        SELECT id FROM user_tokens
        WHERE user_id = ${signUp.user.id} AND type = 'password_reset'
      `;
      expect(tokens).toHaveLength(0);
    });

    test("throttles requests per IP", async () => {
      for (let i = 0; i < 5; i++) {
        await passwordReset.create(postForgot({ email: "flood@example.com" }));
      }

      expect(
        (await passwordReset.create(postForgot({ email: "flood@example.com" })))
          .status,
      ).toBe(429);
    });
  });

  describe("GET /reset-password", () => {
    test("renders the form with the token in a hidden field", async () => {
      const html = await (await passwordReset.edit(getReset("a-token"))).text();

      expect(html).toContain('name="token" value="a-token"');
      expect(html).toContain('autocomplete="new-password"');
    });

    test("does not validate the token, so it can't be used as an oracle", async () => {
      // A made-up token renders the same form as a real one — only spending it
      // reveals anything.
      const madeUp = await (
        await passwordReset.edit(getReset("nonsense"))
      ).text();
      expect(madeUp).toContain('name="token" value="nonsense"');
      expect(madeUp).not.toContain("invalid or has expired");
    });

    test("shows an error when the link has no token at all", async () => {
      const html = await (await passwordReset.edit(getReset())).text();

      expect(html).toContain("invalid or has expired");
    });

    test("404s in magic-link mode", async () => {
      delete process.env.AUTH_MODE;

      expect((await passwordReset.edit(getReset("a-token"))).status).toBe(404);
    });
  });

  describe("POST /reset-password", () => {
    test("sets the new password and signs the user in", async () => {
      const signUp = await signUpWithPassword("reset@example.com", PASSWORD);
      expect(signUp.success).toBe(true);
      if (!signUp.success) return;

      const reset = await createPasswordReset("reset@example.com");
      if (!reset) return;

      const request = postReset({
        token: reset.rawToken,
        password: NEW_PASSWORD,
      });
      const response = await passwordReset.update(request);

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/");
      expect(findSetCookie(request, "session_id")).toBeDefined();

      expect(
        (await signInWithPassword("reset@example.com", NEW_PASSWORD)).success,
      ).toBe(true);
      expect(await signInWithPassword("reset@example.com", PASSWORD)).toEqual({
        success: false,
        reason: "invalid-credentials",
      });
    });

    test("completes when the captcha is enabled", async () => {
      const original = process.env.CAPTCHA_ENABLED;
      process.env.CAPTCHA_ENABLED = "true";
      try {
        const signUp = await signUpWithPassword(
          "captcha@example.com",
          PASSWORD,
        );
        expect(signUp.success).toBe(true);
        if (!signUp.success) return;

        const reset = await createPasswordReset("captcha@example.com");
        if (!reset) return;

        const response = await passwordReset.update(
          postReset({
            token: reset.rawToken,
            password: NEW_PASSWORD,
            [CAPTCHA_SOLUTION_FIELD]: solveChallenge(issueChallenge()),
          }),
        );

        expect(response.status).toBe(303);
        expect(response.headers.get("location")).toBe("/");
        expect(
          (await signInWithPassword("captcha@example.com", NEW_PASSWORD))
            .success,
        ).toBe(true);
      } finally {
        if (original === undefined) delete process.env.CAPTCHA_ENABLED;
        else process.env.CAPTCHA_ENABLED = original;
      }
    });

    test("destroys sessions that existed before the reset", async () => {
      const signUp = await signUpWithPassword("evict@example.com", PASSWORD);
      expect(signUp.success).toBe(true);
      if (!signUp.success) return;

      const oldSessionId = await createAuthenticatedSession(signUp.user.id);
      const reset = await createPasswordReset("evict@example.com");
      if (!reset) return;

      await passwordReset.update(
        postReset({ token: reset.rawToken, password: NEW_PASSWORD }),
      );

      expect(await getSessionContextFromDB(oldSessionId)).toBeNull();
    });

    test("marks the address verified — the link reached their inbox", async () => {
      const signUp = await signUpWithPassword("proof@example.com", PASSWORD);
      expect(signUp.success).toBe(true);
      if (!signUp.success) return;

      const reset = await createPasswordReset("proof@example.com");
      if (!reset) return;

      await passwordReset.update(
        postReset({ token: reset.rawToken, password: NEW_PASSWORD }),
      );

      const rows =
        await db`SELECT email_verified_at FROM users WHERE id = ${signUp.user.id}`;
      expect(rows[0].email_verified_at).not.toBeNull();
    });

    test("rejects a missing, unknown, or already-spent token", async () => {
      const signUp = await signUpWithPassword("once@example.com", PASSWORD);
      expect(signUp.success).toBe(true);
      if (!signUp.success) return;

      const noToken = postReset({ password: NEW_PASSWORD });
      await passwordReset.update(noToken);
      expect(findSetCookie(noToken, "flash_state")).toContain("invalid-token");

      const bogus = postReset({ token: "nope", password: NEW_PASSWORD });
      await passwordReset.update(bogus);
      expect(findSetCookie(bogus, "flash_state")).toContain("invalid-token");

      const reset = await createPasswordReset("once@example.com");
      if (!reset) return;
      await passwordReset.update(
        postReset({ token: reset.rawToken, password: NEW_PASSWORD }),
      );

      const replay = postReset({
        token: reset.rawToken,
        password: "yet-another-passphrase",
      });
      await passwordReset.update(replay);
      expect(findSetCookie(replay, "flash_state")).toContain("invalid-token");
      expect(
        await signInWithPassword("once@example.com", "yet-another-passphrase"),
      ).toEqual({ success: false, reason: "invalid-credentials" });
    });

    test("will not spend a verification token as a reset", async () => {
      const signUp = await signUpWithPassword("cross@example.com", PASSWORD);
      expect(signUp.success).toBe(true);
      if (!signUp.success) return;

      const request = postReset({
        token: signUp.verifyToken,
        password: NEW_PASSWORD,
      });
      await passwordReset.update(request);

      expect(findSetCookie(request, "flash_state")).toContain("invalid-token");
      expect(
        (await signInWithPassword("cross@example.com", PASSWORD)).success,
      ).toBe(true);
    });

    test("keeps the token usable after a too-short password", async () => {
      const signUp = await signUpWithPassword("typo@example.com", PASSWORD);
      expect(signUp.success).toBe(true);
      if (!signUp.success) return;

      const reset = await createPasswordReset("typo@example.com");
      if (!reset) return;

      const bad = postReset({ token: reset.rawToken, password: "short" });
      const response = await passwordReset.update(bad);

      expect(response.headers.get("location")).toContain(
        `token=${reset.rawToken}`,
      );
      expect(findSetCookie(bad, "flash_state")).toContain("between 8 and 128");

      // The retry with a valid password still works.
      await passwordReset.update(
        postReset({ token: reset.rawToken, password: NEW_PASSWORD }),
      );
      expect(
        (await signInWithPassword("typo@example.com", NEW_PASSWORD)).success,
      ).toBe(true);
    });

    // A stale challenge (page left open) must not cost the user their link —
    // nothing spent the token, so they go back to the same one.
    test("keeps the token usable after a failed captcha", async () => {
      const original = process.env.CAPTCHA_ENABLED;
      process.env.CAPTCHA_ENABLED = "true";

      try {
        const signUp = await signUpWithPassword(
          "stalecap@example.com",
          PASSWORD,
        );
        expect(signUp.success).toBe(true);
        if (!signUp.success) return;

        const reset = await createPasswordReset("stalecap@example.com");
        if (!reset) return;

        const blocked = postReset({
          token: reset.rawToken,
          password: NEW_PASSWORD,
          [CAPTCHA_SOLUTION_FIELD]: "not-a-real-solution",
        });
        const response = await passwordReset.update(blocked);

        expect(response.headers.get("location")).toContain(
          `token=${reset.rawToken}`,
        );
        expect(findSetCookie(blocked, "flash_state")).toContain(
          "Verification failed",
        );

        // The retry with a solved challenge still works.
        await passwordReset.update(
          postReset({
            token: reset.rawToken,
            password: NEW_PASSWORD,
            [CAPTCHA_SOLUTION_FIELD]: solveChallenge(issueChallenge()),
          }),
        );
        expect(
          (await signInWithPassword("stalecap@example.com", NEW_PASSWORD))
            .success,
        ).toBe(true);
      } finally {
        if (original === undefined) delete process.env.CAPTCHA_ENABLED;
        else process.env.CAPTCHA_ENABLED = original;
      }
    });

    test("still dead-ends when the guard fails with no token in the body", async () => {
      const blocked = postReset({
        password: NEW_PASSWORD,
        [HONEYPOT_FIELD]: "i-am-a-bot",
      });
      const response = await passwordReset.update(blocked);

      expect(response.headers.get("location")).toBe("/reset-password");
      expect(findSetCookie(blocked, "flash_state")).toContain("invalid-token");
    });

    test("rejects an expired token", async () => {
      const signUp = await signUpWithPassword("stale@example.com", PASSWORD);
      expect(signUp.success).toBe(true);
      if (!signUp.success) return;

      const rawToken = await createUserToken(signUp.user.id, "password_reset");
      await db`UPDATE user_tokens SET expires_at = NOW() - INTERVAL '1 minute' WHERE type = 'password_reset'`;

      const request = postReset({ token: rawToken, password: NEW_PASSWORD });
      await passwordReset.update(request);

      expect(findSetCookie(request, "flash_state")).toContain("invalid-token");
      expect(
        (await signInWithPassword("stale@example.com", PASSWORD)).success,
      ).toBe(true);
    });

    test("404s in magic-link mode", async () => {
      delete process.env.AUTH_MODE;

      expect(
        (
          await passwordReset.update(
            postReset({ token: "anything", password: NEW_PASSWORD }),
          )
        ).status,
      ).toBe(404);
    });
  });
});
