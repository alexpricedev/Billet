// Dev sign-in links. With DEV_LOGIN=true the server prints one link per account
// below once it is listening (utils/startup.ts), and following one signs the
// browser in.
// It exists because every Conductor workspace has its own database and its own
// session cookie name, so no session survives into a new worktree and the
// developer would otherwise sign in by hand in each one.
//
// Off by default, and three things have to hold before a link works: the flag,
// a NODE_ENV other than production, and a DATABASE_URL on this machine. The
// last two are also fatal at boot (`devLoginProblem`, called by validateEnv)
// rather than quietly ignored — NODE_ENV is usually unset on a laptop, so on
// its own it would wave through an `.env` pointed at a hosted database.
//
// Read from process.env on every call (not captured at import) so tests can
// flip it between cases, matching `teamsEnabled` in teams-mode.ts.

import { isLocalDatabaseUrl } from "../fixtures/guard";
import { computeHMAC, verifyHMAC } from "../utils/crypto";
import type { PlatformRole } from "./auth";

export const DEV_LOGIN_FLAG_VALUES = ["true", "false"] as const;

export type DevLoginFlagValue = (typeof DEV_LOGIN_FLAG_VALUES)[number];

export const isDevLoginFlagValue = (
  value: string | undefined,
): value is DevLoginFlagValue =>
  DEV_LOGIN_FLAG_VALUES.includes(value as DevLoginFlagValue);

/**
 * Whether the dev sign-in links are live.
 *
 * The production check is repeated here although validateEnv refuses to boot
 * over it: a controller is the last thing between this route and a session, and
 * it should not depend on a check that ran once, somewhere else.
 */
export const devLoginEnabled = (): boolean =>
  process.env.DEV_LOGIN === "true" && process.env.NODE_ENV !== "production";

/**
 * Why DEV_LOGIN can't be honoured as configured, or null when it can.
 *
 * Exported for the same reason as `urlProblem`: validateEnv answers a problem
 * with process.exit(1), which a test can't call without taking the runner down.
 */
export const devLoginProblem = (): string | null => {
  const value = process.env.DEV_LOGIN;
  if (value === undefined) return null;

  if (!isDevLoginFlagValue(value)) {
    return `DEV_LOGIN must be one of: ${DEV_LOGIN_FLAG_VALUES.join(", ")} (got "${value}")`;
  }

  if (value === "false") return null;

  if (process.env.NODE_ENV === "production") {
    return "DEV_LOGIN=true is refused with NODE_ENV=production: it signs a browser in as a platform admin without a credential";
  }

  if (!isLocalDatabaseUrl(process.env.DATABASE_URL)) {
    return "DEV_LOGIN=true is refused unless the DATABASE_URL host is localhost, 127.0.0.1 or ::1";
  }

  return null;
};

export const DEV_LOGIN_PATH = "/dev/login";

// Both come from database/seed.ts, so a fresh workspace database already has
// them. The link names a key of this map and never an address: the two rows it
// can reach are fixed here, not chosen by whoever builds the URL.
export const DEV_LOGIN_ACCOUNTS = {
  admin: { email: "admin@example.com", role: "admin" },
  user: { email: "alice@example.com", role: "user" },
} as const satisfies Record<string, { email: string; role: PlatformRole }>;

export type DevLoginAccount = keyof typeof DEV_LOGIN_ACCOUNTS;

export const isDevLoginAccount = (value: unknown): value is DevLoginAccount =>
  typeof value === "string" && Object.hasOwn(DEV_LOGIN_ACCOUNTS, value);

/**
 * The token a link for `account` carries.
 *
 * Derived from CRYPTO_PEPPER rather than generated at boot, so a link survives
 * a restart — `bun --watch` restarts on every save — and can be bookmarked. It
 * is as secret as the pepper is: anyone who can read `.env` can already forge a
 * session outright. Rotating the pepper rotates it.
 */
export const devLoginToken = (account: DevLoginAccount): string =>
  computeHMAC(`dev-login:${account}`);

// Both sides are hashed before comparing because timingSafeEqual throws on
// inputs of different lengths, and the candidate is whatever the URL carried.
export const isDevLoginToken = (
  account: DevLoginAccount,
  candidate: string | null,
): boolean =>
  Boolean(candidate) &&
  verifyHMAC(candidate as string, computeHMAC(devLoginToken(account)));

export const devLoginUrl = (port: number, account: DevLoginAccount): string =>
  `http://localhost:${port}${DEV_LOGIN_PATH}?as=${account}&token=${devLoginToken(account)}`;
