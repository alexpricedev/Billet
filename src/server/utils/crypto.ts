import { createHmac, timingSafeEqual } from "node:crypto";

const PEPPER = process.env.CRYPTO_PEPPER;

if (!PEPPER) {
  throw new Error("CRYPTO_PEPPER environment variable is required");
}

/**
 * Compute HMAC-SHA256 of a value using the application pepper
 */
export const computeHMAC = (value: string): string => {
  return createHmac("sha256", PEPPER).update(value).digest("hex");
};

/**
 * Verify an HMAC hash against a value using timing-safe comparison
 */
export const verifyHMAC = (value: string, hash: string): boolean => {
  const computed = computeHMAC(value);
  return timingSafeEqual(
    Buffer.from(computed, "hex"),
    Buffer.from(hash, "hex"),
  );
};

/**
 * Hash a password for storage with argon2id.
 *
 * Deliberately NOT peppered with CRYPTO_PEPPER, unlike every other hash in this
 * file. Argon2id carries a unique per-hash salt, and mixing the pepper in would
 * make rotating it unrecoverable for passwords: today a rotation only logs
 * everyone out, whereas peppered passwords would all become permanently
 * unverifiable and every user would need a reset.
 */
export const hashPassword = (password: string): Promise<string> =>
  Bun.password.hash(password, { algorithm: "argon2id" });

/**
 * Verify a password against a stored argon2id hash. Constant-time internally.
 * Returns false rather than throwing when the stored hash is malformed.
 */
export const verifyPassword = async (
  password: string,
  hash: string,
): Promise<boolean> => {
  try {
    return await Bun.password.verify(password, hash, "argon2id");
  } catch {
    return false;
  }
};

/**
 * Generate a cryptographically secure random string
 * Uses the same format as nanoid but with different length
 */
export const generateSecureToken = (length = 32): string => {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let result = "";

  // Use Node.js crypto for secure random generation (Bun environment)
  const { randomBytes } = require("node:crypto");
  const values = randomBytes(length);

  for (let i = 0; i < length; i++) {
    result += chars[values[i] % chars.length];
  }

  return result;
};
