import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  DEV_LOGIN_ACCOUNTS,
  devLoginEnabled,
  devLoginProblem,
  devLoginToken,
  devLoginUrl,
  isDevLoginAccount,
  isDevLoginFlagValue,
  isDevLoginToken,
} from "./dev-login";

const original = {
  DEV_LOGIN: process.env.DEV_LOGIN,
  NODE_ENV: process.env.NODE_ENV,
  DATABASE_URL: process.env.DATABASE_URL,
};

const restore = (key: keyof typeof original) => {
  if (original[key] === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = original[key];
  }
};

beforeEach(() => {
  delete process.env.DEV_LOGIN;
});

afterEach(() => {
  restore("DEV_LOGIN");
  restore("NODE_ENV");
  restore("DATABASE_URL");
});

describe("devLoginEnabled", () => {
  test("defaults to off when unset", () => {
    expect(devLoginEnabled()).toBe(false);
  });

  test("is on only for the exact string true", () => {
    process.env.DEV_LOGIN = "true";
    expect(devLoginEnabled()).toBe(true);

    process.env.DEV_LOGIN = "1";
    expect(devLoginEnabled()).toBe(false);
  });

  // validateEnv refuses to boot over this combination; the flag check must not
  // depend on that having run.
  test("is off in production even with the flag set", () => {
    process.env.DEV_LOGIN = "true";
    process.env.NODE_ENV = "production";
    expect(devLoginEnabled()).toBe(false);
  });
});

describe("isDevLoginFlagValue", () => {
  test("accepts the two supported values", () => {
    expect(isDevLoginFlagValue("true")).toBe(true);
    expect(isDevLoginFlagValue("false")).toBe(true);
  });

  test("rejects the near-misses validateEnv must catch", () => {
    expect(isDevLoginFlagValue("1")).toBe(false);
    expect(isDevLoginFlagValue("TRUE")).toBe(false);
    expect(isDevLoginFlagValue("")).toBe(false);
    expect(isDevLoginFlagValue(undefined)).toBe(false);
  });
});

describe("devLoginProblem", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgres://u:p@localhost:5432/app";
  });

  test("unset and false are fine anywhere", () => {
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgres://u:p@db.example.com/app";

    expect(devLoginProblem()).toBeNull();
    process.env.DEV_LOGIN = "false";
    expect(devLoginProblem()).toBeNull();
  });

  test("true is fine against a local database outside production", () => {
    process.env.DEV_LOGIN = "true";
    expect(devLoginProblem()).toBeNull();
  });

  test("a typo is named", () => {
    process.env.DEV_LOGIN = "yes";
    expect(devLoginProblem()).toBe(
      'DEV_LOGIN must be one of: true, false (got "yes")',
    );
  });

  test("true is refused in production", () => {
    process.env.DEV_LOGIN = "true";
    process.env.NODE_ENV = "production";
    expect(devLoginProblem()).toContain("NODE_ENV=production");
  });

  // NODE_ENV is usually unset on a laptop, so the production check alone
  // would pass an `.env` pointed at a hosted database.
  test.each(["postgres://u:p@db.example.com:5432/app", "not a url"])(
    "true is refused when DATABASE_URL is %s",
    (url) => {
      process.env.DEV_LOGIN = "true";
      process.env.DATABASE_URL = url;
      expect(devLoginProblem()).toContain("DATABASE_URL");
    },
  );

  test("true is refused when DATABASE_URL is missing", () => {
    process.env.DEV_LOGIN = "true";
    delete process.env.DATABASE_URL;
    expect(devLoginProblem()).toContain("DATABASE_URL");
  });
});

describe("accounts", () => {
  test("one admin and one non-admin", () => {
    expect(DEV_LOGIN_ACCOUNTS.admin.role).toBe("admin");
    expect(DEV_LOGIN_ACCOUNTS.user.role).toBe("user");
  });

  test("only the map's own keys name an account", () => {
    expect(isDevLoginAccount("admin")).toBe(true);
    expect(isDevLoginAccount("user")).toBe(true);
    expect(isDevLoginAccount("owner")).toBe(false);
    expect(isDevLoginAccount("toString")).toBe(false);
    expect(isDevLoginAccount("")).toBe(false);
    expect(isDevLoginAccount(null)).toBe(false);
  });
});

describe("tokens", () => {
  // The point of deriving it from the pepper: the link printed before a
  // restart still works after it.
  test("the same account always gets the same token", () => {
    expect(devLoginToken("admin")).toBe(devLoginToken("admin"));
  });

  test("each account has its own, so one link can't be edited into the other", () => {
    expect(devLoginToken("admin")).not.toBe(devLoginToken("user"));
    expect(isDevLoginToken("admin", devLoginToken("user"))).toBe(false);
  });

  test("accepts its own token and nothing else", () => {
    expect(isDevLoginToken("admin", devLoginToken("admin"))).toBe(true);
    expect(isDevLoginToken("admin", "nope")).toBe(false);
    expect(isDevLoginToken("admin", "")).toBe(false);
    expect(isDevLoginToken("admin", null)).toBe(false);
  });

  test("the url carries the account and its token on the given port", () => {
    expect(devLoginUrl(4321, "user")).toBe(
      `http://localhost:4321/dev/login?as=user&token=${devLoginToken("user")}`,
    );
  });
});
