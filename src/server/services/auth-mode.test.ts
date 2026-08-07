import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { authMode, isAuthMode, passwordAuthEnabled } from "./auth-mode";

const original = process.env.AUTH_MODE;

beforeEach(() => {
  delete process.env.AUTH_MODE;
});

afterEach(() => {
  if (original === undefined) {
    delete process.env.AUTH_MODE;
  } else {
    process.env.AUTH_MODE = original;
  }
});

describe("authMode", () => {
  test("defaults to magic-link when unset", () => {
    expect(authMode()).toBe("magic-link");
    expect(passwordAuthEnabled()).toBe(false);
  });

  test("returns password when set to password", () => {
    process.env.AUTH_MODE = "password";
    expect(authMode()).toBe("password");
    expect(passwordAuthEnabled()).toBe(true);
  });

  test("returns magic-link when set explicitly", () => {
    process.env.AUTH_MODE = "magic-link";
    expect(authMode()).toBe("magic-link");
    expect(passwordAuthEnabled()).toBe(false);
  });

  test("reads the env on every call so a mode change takes effect", () => {
    expect(passwordAuthEnabled()).toBe(false);
    process.env.AUTH_MODE = "password";
    expect(passwordAuthEnabled()).toBe(true);
    delete process.env.AUTH_MODE;
    expect(passwordAuthEnabled()).toBe(false);
  });
});

describe("isAuthMode", () => {
  test("accepts the two supported modes", () => {
    expect(isAuthMode("magic-link")).toBe(true);
    expect(isAuthMode("password")).toBe(true);
  });

  test("rejects anything else, including near-misses validateEnv must catch", () => {
    expect(isAuthMode("passwords")).toBe(false);
    expect(isAuthMode("magiclink")).toBe(false);
    expect(isAuthMode("Password")).toBe(false);
    expect(isAuthMode("")).toBe(false);
    expect(isAuthMode(undefined)).toBe(false);
  });
});
