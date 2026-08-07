import { describe, expect, test } from "bun:test";
import { computeHMAC, hashPassword, verifyPassword } from "./crypto";

describe("hashPassword", () => {
  test("produces an argon2id hash, never the plaintext", async () => {
    const hash = await hashPassword("correct horse battery staple");

    expect(hash).toStartWith("$argon2id$");
    expect(hash).not.toContain("correct horse battery staple");
  });

  test("salts each hash, so the same password hashes differently", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");

    expect(a).not.toBe(b);
    expect(await verifyPassword("same-password", a)).toBe(true);
    expect(await verifyPassword("same-password", b)).toBe(true);
  });

  test("is not derived from CRYPTO_PEPPER", async () => {
    // Passwords are deliberately unpeppered so a pepper rotation stays
    // recoverable — see the comment on hashPassword.
    const hash = await hashPassword("pepper-check");
    expect(hash).not.toContain(computeHMAC("pepper-check"));
  });
});

describe("verifyPassword", () => {
  test("accepts the right password", async () => {
    const hash = await hashPassword("s3cret-passphrase");
    expect(await verifyPassword("s3cret-passphrase", hash)).toBe(true);
  });

  test("rejects the wrong password", async () => {
    const hash = await hashPassword("s3cret-passphrase");
    expect(await verifyPassword("s3cret-passphras", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  test("preserves surrounding whitespace as part of the password", async () => {
    const hash = await hashPassword("  spaced out  ");

    expect(await verifyPassword("  spaced out  ", hash)).toBe(true);
    expect(await verifyPassword("spaced out", hash)).toBe(false);
  });

  test("returns false instead of throwing on a malformed hash", async () => {
    expect(await verifyPassword("anything", "not-a-hash")).toBe(false);
    expect(await verifyPassword("anything", "")).toBe(false);
  });
});
