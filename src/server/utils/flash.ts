import type { BunRequest } from "bun";
import { computeHMAC, verifyHMAC } from "./crypto";

const FLASH_COOKIE_PREFIX = "flash_";
const FLASH_COOKIE_MAX_AGE = 300; // 5 minutes

interface FlashCookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax" | "strict" | "none";
  path: string;
  maxAge: number;
}

const getFlashCookieOptions = (): FlashCookieOptions => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: FLASH_COOKIE_MAX_AGE,
});

export const setFlashCookie = <T>(
  req: BunRequest,
  key: string,
  data: T,
): void => {
  const cookieName = `${FLASH_COOKIE_PREFIX}${key}`;
  const payload = JSON.stringify(data);
  const signature = computeHMAC(payload);
  const signedValue = `${signature}.${payload}`;

  req.cookies.set(cookieName, signedValue, getFlashCookieOptions());
};

export const getFlashCookie = <T>(req: BunRequest, key: string): T => {
  const cookieName = `${FLASH_COOKIE_PREFIX}${key}`;
  const signedValue = req.cookies.get(cookieName);

  if (!signedValue) {
    return {} as T;
  }

  req.cookies.delete(cookieName);

  try {
    const dotIndex = signedValue.indexOf(".");
    if (dotIndex === -1) {
      return {} as T;
    }

    const providedSignature = signedValue.slice(0, dotIndex);
    const payload = signedValue.slice(dotIndex + 1);

    if (!verifyHMAC(payload, providedSignature)) {
      return {} as T;
    }

    return JSON.parse(payload) as T;
  } catch {
    return {} as T;
  }
};
