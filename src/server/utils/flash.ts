import type { BunRequest } from "bun";
import { computeHMAC } from "./crypto";

const FLASH_COOKIE_PREFIX = "flash_";
const FLASH_COOKIE_MAX_AGE = 300; // 5 minutes

/**
 * Set a flash cookie using Bun's native cookies API
 * Flash cookies are HMAC-signed, short-lived, and intended for one-time use
 */
export const setFlashCookie = <T>(
  req: BunRequest,
  key: string,
  data: T,
): void => {
  const cookieName = `${FLASH_COOKIE_PREFIX}${key}`;
  const payload = JSON.stringify(data);
  const signature = computeHMAC(payload);
  const signedValue = `${signature}.${payload}`;

  req.cookies.set(cookieName, signedValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: FLASH_COOKIE_MAX_AGE,
  });
};

/**
 * Get and verify a flash cookie, then immediately delete it (read-once pattern)
 * Returns the decoded data if valid, empty object if invalid/missing
 */
export const getFlashCookie = <T>(req: BunRequest, key: string): T => {
  const cookieName = `${FLASH_COOKIE_PREFIX}${key}`;
  const signedValue = req.cookies.get(cookieName);

  if (!signedValue) {
    return {} as T;
  }

  // Delete immediately (read-once pattern)
  req.cookies.delete(cookieName);

  try {
    const dotIndex = signedValue.indexOf(".");
    if (dotIndex === -1) {
      return {} as T;
    }

    const providedSignature = signedValue.slice(0, dotIndex);
    const payload = signedValue.slice(dotIndex + 1);

    // Verify HMAC signature
    const expectedSignature = computeHMAC(payload);
    if (providedSignature !== expectedSignature) {
      return {} as T;
    }

    return JSON.parse(payload) as T;
  } catch {
    return {} as T;
  }
};
