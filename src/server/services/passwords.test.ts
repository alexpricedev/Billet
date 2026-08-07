import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { SQL } from "bun";
import { cleanupTestData } from "../test-utils/helpers";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for tests");
}
const connection = new SQL(process.env.DATABASE_URL);

mock.module("./database", () => ({
  get db() {
    return connection;
  },
}));

import { computeHMAC } from "../utils/crypto";
import { createUserToken, findOrCreateUser } from "./auth";
import { db } from "./database";
import {
  changePassword,
  createPasswordReset,
  MAX_PASSWORD_LENGTH,
  resetPassword,
  setInitialPassword,
  signInWithPassword,
  signUpWithPassword,
  userHasPassword,
  validatePassword,
  verifyEmailToken,
} from "./passwords";
import {
  createAuthenticatedSession,
  getSessionContextFromDB,
} from "./sessions";

const PASSWORD = "correct-horse-battery";

describe("Passwords Service with PostgreSQL", () => {
  beforeEach(async () => {
    await cleanupTestData(db);
  });

  afterAll(async () => {
    await connection.end();
    mock.restore();
  });

  describe("validatePassword", () => {
    test("accepts anything at least 8 characters", () => {
      expect(validatePassword("12345678")).toBeNull();
      expect(validatePassword("a".repeat(MAX_PASSWORD_LENGTH))).toBeNull();
    });

    test("rejects short and over-long values", () => {
      expect(validatePassword("1234567")).toContain("at least 8");
      expect(validatePassword("")).toContain("at least 8");
      expect(validatePassword("a".repeat(MAX_PASSWORD_LENGTH + 1))).toContain(
        "128 characters or fewer",
      );
    });

    test("imposes no composition rules", () => {
      expect(validatePassword("aaaaaaaa")).toBeNull();
      expect(validatePassword("        ")).toBeNull();
    });
  });

  describe("signUpWithPassword", () => {
    test("creates an unverified user and a verification token", async () => {
      const result = await signUpWithPassword("new@example.com", PASSWORD);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.user.email).toBe("new@example.com");
      expect(result.user.email_verified_at).toBeNull();
      expect(result.verifyToken).toBeTruthy();

      const tokens = await db`
        SELECT type FROM user_tokens WHERE user_id = ${result.user.id}
      `;
      expect(tokens).toHaveLength(1);
      expect(tokens[0].type).toBe("email_verification");
    });

    test("stores an argon2id hash, never the password", async () => {
      const result = await signUpWithPassword("hashed@example.com", PASSWORD);
      expect(result.success).toBe(true);
      if (!result.success) return;

      const rows =
        await db`SELECT password_hash FROM users WHERE id = ${result.user.id}`;
      expect(rows[0].password_hash).toStartWith("$argon2id$");
      expect(rows[0].password_hash).not.toContain(PASSWORD);
    });

    test("normalizes the email", async () => {
      await signUpWithPassword("  MiXeD@Example.COM  ", PASSWORD);

      const rows = await db`SELECT email FROM users`;
      expect(rows[0].email).toBe("mixed@example.com");
    });

    test("rejects an address that already exists", async () => {
      await findOrCreateUser("taken@example.com");

      const result = await signUpWithPassword("taken@example.com", PASSWORD);

      expect(result).toEqual({ success: false, error: "email-taken" });
    });

    test("rejects an invalid password before touching the database", async () => {
      const result = await signUpWithPassword("short@example.com", "abc");

      expect(result).toEqual({ success: false, error: "invalid-password" });
      expect(await db`SELECT id FROM users`).toHaveLength(0);
    });

    test("only one of two concurrent signups for an address wins", async () => {
      const [a, b] = await Promise.all([
        signUpWithPassword("race@example.com", PASSWORD),
        signUpWithPassword("race@example.com", PASSWORD),
      ]);

      expect([a.success, b.success].filter(Boolean)).toHaveLength(1);
      expect(await db`SELECT id FROM users`).toHaveLength(1);
    });
  });

  describe("signInWithPassword", () => {
    test("returns the user for the right password", async () => {
      const signUp = await signUpWithPassword("signin@example.com", PASSWORD);
      expect(signUp.success).toBe(true);

      const result = await signInWithPassword("signin@example.com", PASSWORD);

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.user.email).toBe("signin@example.com");
    });

    test("never leaks the password hash to callers", async () => {
      await signUpWithPassword("leak@example.com", PASSWORD);

      const result = await signInWithPassword("leak@example.com", PASSWORD);

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.user).not.toHaveProperty("password_hash");
    });

    test("gives the same reason for a wrong password and an unknown address", async () => {
      await signUpWithPassword("wrong@example.com", PASSWORD);

      // The pair that must stay merged: telling these apart would make the
      // form a way to test which addresses are registered.
      expect(
        await signInWithPassword("wrong@example.com", "not-it-at-all"),
      ).toEqual({ success: false, reason: "invalid-credentials" });
      expect(await signInWithPassword("ghost@example.com", PASSWORD)).toEqual({
        success: false,
        reason: "invalid-credentials",
      });
    });

    test("reports a magic-link account with no password separately", async () => {
      await findOrCreateUser("passwordless@example.com");

      // The deliberate exception — there is no password to get right, so the
      // generic answer would strand the user. See SECURITY.md.
      expect(
        await signInWithPassword("passwordless@example.com", PASSWORD),
      ).toEqual({ success: false, reason: "no-password" });
    });

    test("matches case-insensitively on the address", async () => {
      await signUpWithPassword("case@example.com", PASSWORD);

      expect(
        (await signInWithPassword("CASE@Example.com", PASSWORD)).success,
      ).toBe(true);
    });

    test("treats surrounding whitespace as part of the password", async () => {
      await signUpWithPassword("spaces@example.com", "  padded pass  ");

      expect(
        await signInWithPassword("spaces@example.com", "padded pass"),
      ).toEqual({ success: false, reason: "invalid-credentials" });
      expect(
        (await signInWithPassword("spaces@example.com", "  padded pass  "))
          .success,
      ).toBe(true);
    });
  });

  describe("userHasPassword", () => {
    test("distinguishes a password account from a carried-over one", async () => {
      const signUp = await signUpWithPassword("has@example.com", PASSWORD);
      expect(signUp.success).toBe(true);
      if (!signUp.success) return;

      const carried = await findOrCreateUser("none@example.com");

      expect(await userHasPassword(signUp.user.id)).toBe(true);
      expect(await userHasPassword(carried.id)).toBe(false);
    });
  });

  describe("setInitialPassword", () => {
    test("gives a carried-over account its first password", async () => {
      const user = await findOrCreateUser("carried@example.com");

      expect(await setInitialPassword(user.id, "brand-new-passphrase")).toEqual(
        {
          success: true,
        },
      );
      expect(
        (
          await signInWithPassword(
            "carried@example.com",
            "brand-new-passphrase",
          )
        ).success,
      ).toBe(true);
    });

    // The `AND password_hash IS NULL` in the UPDATE is what stops this being a
    // way to replace a password without proving the current one.
    test("refuses an account that already has a password", async () => {
      const signUp = await signUpWithPassword("taken@example.com", PASSWORD);
      expect(signUp.success).toBe(true);
      if (!signUp.success) return;

      expect(
        await setInitialPassword(signUp.user.id, "attacker-chosen-passphrase"),
      ).toEqual({ success: false, error: "already-set" });
      expect(
        (await signInWithPassword("taken@example.com", PASSWORD)).success,
      ).toBe(true);
    });

    test("rejects an invalid password without touching the row", async () => {
      const user = await findOrCreateUser("weakfirst@example.com");

      expect(await setInitialPassword(user.id, "short")).toEqual({
        success: false,
        error: "invalid-password",
      });
      expect(await userHasPassword(user.id)).toBe(false);
    });

    test("drops other sessions but keeps the one passed through", async () => {
      const user = await findOrCreateUser("evictfirst@example.com");
      const keep = await createAuthenticatedSession(user.id);
      const other = await createAuthenticatedSession(user.id);

      const keepHash = (await getSessionContextFromDB(keep))?.sessionHash;
      await setInitialPassword(user.id, "brand-new-passphrase", keepHash ?? "");

      expect(await getSessionContextFromDB(keep)).not.toBeNull();
      expect(await getSessionContextFromDB(other)).toBeNull();
    });
  });

  describe("changePassword", () => {
    test("swaps the password when the current one matches", async () => {
      const signUp = await signUpWithPassword("change@example.com", PASSWORD);
      expect(signUp.success).toBe(true);
      if (!signUp.success) return;

      const result = await changePassword(
        signUp.user.id,
        PASSWORD,
        "brand-new-passphrase",
      );

      expect(result).toEqual({ success: true });
      expect(
        (await signInWithPassword("change@example.com", "brand-new-passphrase"))
          .success,
      ).toBe(true);
      expect(await signInWithPassword("change@example.com", PASSWORD)).toEqual({
        success: false,
        reason: "invalid-credentials",
      });
    });

    test("rejects a wrong current password and leaves the old one working", async () => {
      const signUp = await signUpWithPassword("guard@example.com", PASSWORD);
      expect(signUp.success).toBe(true);
      if (!signUp.success) return;

      const result = await changePassword(
        signUp.user.id,
        "not-the-current-one",
        "brand-new-passphrase",
      );

      expect(result).toEqual({ success: false, error: "wrong-password" });
      expect(
        (await signInWithPassword("guard@example.com", PASSWORD)).success,
      ).toBe(true);
    });

    test("rejects an invalid new password", async () => {
      const signUp = await signUpWithPassword("weak@example.com", PASSWORD);
      expect(signUp.success).toBe(true);
      if (!signUp.success) return;

      expect(await changePassword(signUp.user.id, PASSWORD, "short")).toEqual({
        success: false,
        error: "invalid-password",
      });
    });

    test("fails for a magic-link account with no password to confirm", async () => {
      const user = await findOrCreateUser("nopass@example.com");

      expect(await changePassword(user.id, PASSWORD, "brand-new-pass")).toEqual(
        {
          success: false,
          error: "wrong-password",
        },
      );
    });

    test("keeps the current session and drops every other one", async () => {
      const signUp = await signUpWithPassword("sessions@example.com", PASSWORD);
      expect(signUp.success).toBe(true);
      if (!signUp.success) return;

      const keptRawId = await createAuthenticatedSession(signUp.user.id);
      const otherRawId = await createAuthenticatedSession(signUp.user.id);

      await changePassword(
        signUp.user.id,
        PASSWORD,
        "brand-new-passphrase",
        computeHMAC(keptRawId),
      );

      expect(await getSessionContextFromDB(keptRawId)).not.toBeNull();
      expect(await getSessionContextFromDB(otherRawId)).toBeNull();
    });
  });

  describe("createPasswordReset", () => {
    test("mints a reset token for a known address", async () => {
      const user = await findOrCreateUser("reset@example.com");

      const result = await createPasswordReset("reset@example.com");

      expect(result?.user.id).toBe(user.id);
      const rows =
        await db`SELECT type FROM user_tokens WHERE user_id = ${user.id}`;
      expect(rows[0].type).toBe("password_reset");
    });

    test("returns null for an unknown address without creating a user", async () => {
      expect(await createPasswordReset("nobody@example.com")).toBeNull();
      expect(await db`SELECT id FROM users`).toHaveLength(0);
    });
  });

  describe("resetPassword", () => {
    test("sets the new password and marks the address verified", async () => {
      const user = await findOrCreateUser("newpass@example.com");
      const reset = await createPasswordReset("newpass@example.com");
      expect(reset).not.toBeNull();
      if (!reset) return;

      const result = await resetPassword(reset.rawToken, "a-fresh-passphrase");

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.user.id).toBe(user.id);
      expect(result.user.email_verified_at).toBeInstanceOf(Date);
      expect(
        (await signInWithPassword("newpass@example.com", "a-fresh-passphrase"))
          .success,
      ).toBe(true);
    });

    test("is single-use", async () => {
      await findOrCreateUser("once@example.com");
      const reset = await createPasswordReset("once@example.com");
      if (!reset) return;

      expect(
        (await resetPassword(reset.rawToken, "first-passphrase")).success,
      ).toBe(true);
      expect(await resetPassword(reset.rawToken, "second-passphrase")).toEqual({
        success: false,
        error: "invalid-token",
      });
      // The second attempt must not have taken effect.
      expect(
        await signInWithPassword("once@example.com", "second-passphrase"),
      ).toEqual({ success: false, reason: "invalid-credentials" });
    });

    test("rejects an unknown or expired token", async () => {
      expect(
        await resetPassword("not-a-real-token", "some-passphrase"),
      ).toEqual({
        success: false,
        error: "invalid-token",
      });

      const user = await findOrCreateUser("stale@example.com");
      const rawToken = await createUserToken(user.id, "password_reset");
      await db`UPDATE user_tokens SET expires_at = NOW() - INTERVAL '1 minute' WHERE user_id = ${user.id}`;

      expect(await resetPassword(rawToken, "some-passphrase")).toEqual({
        success: false,
        error: "invalid-token",
      });
    });

    test("validates the new password before spending the token", async () => {
      await findOrCreateUser("keeptoken@example.com");
      const reset = await createPasswordReset("keeptoken@example.com");
      if (!reset) return;

      expect(await resetPassword(reset.rawToken, "short")).toEqual({
        success: false,
        error: "invalid-password",
      });

      // Token survives, so a user who fat-fingers the form can retry the link.
      expect(
        (await resetPassword(reset.rawToken, "a-fine-passphrase")).success,
      ).toBe(true);
    });

    test("destroys every existing session", async () => {
      const user = await findOrCreateUser("evict@example.com");
      const sessionA = await createAuthenticatedSession(user.id);
      const sessionB = await createAuthenticatedSession(user.id);

      const reset = await createPasswordReset("evict@example.com");
      if (!reset) return;
      await resetPassword(reset.rawToken, "a-fresh-passphrase");

      expect(await getSessionContextFromDB(sessionA)).toBeNull();
      expect(await getSessionContextFromDB(sessionB)).toBeNull();
    });
  });

  describe("verifyEmailToken", () => {
    test("marks the address verified", async () => {
      const signUp = await signUpWithPassword("confirm@example.com", PASSWORD);
      expect(signUp.success).toBe(true);
      if (!signUp.success) return;

      const user = await verifyEmailToken(signUp.verifyToken);

      expect(user?.id).toBe(signUp.user.id);
      expect(user?.email_verified_at).toBeInstanceOf(Date);
    });

    test("is single-use and rejects unknown tokens", async () => {
      const signUp = await signUpWithPassword("twice@example.com", PASSWORD);
      expect(signUp.success).toBe(true);
      if (!signUp.success) return;

      expect(await verifyEmailToken(signUp.verifyToken)).not.toBeNull();
      expect(await verifyEmailToken(signUp.verifyToken)).toBeNull();
      expect(await verifyEmailToken("not-a-real-token")).toBeNull();
    });

    test("keeps the original timestamp when already verified", async () => {
      const signUp = await signUpWithPassword("already@example.com", PASSWORD);
      expect(signUp.success).toBe(true);
      if (!signUp.success) return;

      const first = await verifyEmailToken(signUp.verifyToken);
      const secondToken = await createUserToken(
        signUp.user.id,
        "email_verification",
      );
      const second = await verifyEmailToken(secondToken);

      expect(second?.email_verified_at).toEqual(first?.email_verified_at);
    });
  });
});
