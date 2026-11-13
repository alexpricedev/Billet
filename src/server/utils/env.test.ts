import { afterEach, describe, expect, test } from "bun:test";
import {
  cookieNameProblem,
  databaseTlsProblem,
  PEPPER_MIN_LENGTH,
  pepperProblem,
  urlProblem,
} from "./env";

// validateEnv() itself answers a bad value with process.exit(1), so these
// exercise the rule it applies rather than the function that applies it.

const NODE_ENV = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = NODE_ENV;
});

describe("urlProblem", () => {
  test("accepts an absolute https URL", () => {
    expect(urlProblem("APP_URL", "https://example.com")).toBeNull();
  });

  test("accepts http outside production, where localhost has no TLS", () => {
    expect(urlProblem("APP_URL", "http://localhost:3000")).toBeNull();
  });

  test("rejects a value with no scheme", () => {
    expect(urlProblem("APP_URL", "example.com")).toBe(
      'APP_URL must be an absolute URL including the scheme (got "example.com")',
    );
  });

  // new URL() parses this happily and reports an origin of the literal string
  // "null", which would ship canonicals reading "null/stack".
  test("rejects a URL that parses but isn't http(s)", () => {
    expect(urlProblem("SITE_URL", "mailto:hi@example.com")).toBe(
      'SITE_URL must use http:// or https:// (got "mailto:hi@example.com")',
    );
  });

  test("rejects http in production", () => {
    process.env.NODE_ENV = "production";

    expect(urlProblem("APP_URL", "http://example.com")).toBe(
      'APP_URL must use https:// in production (got "http://example.com")',
    );
  });

  test("names the key it was given, so the message points at the fix", () => {
    expect(urlProblem("SITE_URL", "nope")).toContain("SITE_URL");
  });
});

describe("pepperProblem", () => {
  test("accepts a generated pepper", () => {
    expect(pepperProblem("a".repeat(64))).toBeNull();
  });

  test("accepts exactly the minimum length", () => {
    expect(pepperProblem("a".repeat(PEPPER_MIN_LENGTH))).toBeNull();
  });

  test("rejects a short value and says how to fix it", () => {
    const problem = pepperProblem("short");

    expect(problem).toContain(`at least ${PEPPER_MIN_LENGTH} characters`);
    expect(problem).toContain("generate:pepper");
  });

  test("rejects the .env.example placeholder by name", () => {
    expect(pepperProblem("something-random")).toContain("placeholder");
  });
});

describe("databaseTlsProblem", () => {
  test("is silent for loopback, where nothing leaves the machine", () => {
    expect(databaseTlsProblem("postgres://u:p@localhost:5432/app")).toBeNull();
    expect(databaseTlsProblem("postgres://u:p@127.0.0.1/app")).toBeNull();
    expect(databaseTlsProblem("postgres://u:p@[::1]/app")).toBeNull();
  });

  test("is silent for a unix socket, which has no host", () => {
    expect(databaseTlsProblem("postgres:///app")).toBeNull();
  });

  test("is silent once sslmode is stated, whatever the value", () => {
    expect(
      databaseTlsProblem("postgres://u:p@db.internal/app?sslmode=verify-full"),
    ).toBeNull();
    // An explicit disable is a decision, not an oversight.
    expect(
      databaseTlsProblem("postgres://u:p@db.internal/app?sslmode=disable"),
    ).toBeNull();
  });

  test("names the host when a remote URL has no sslmode", () => {
    const problem = databaseTlsProblem("postgresql://u:p@db.internal:5432/app");

    expect(problem).toContain("db.internal");
    expect(problem).toContain("sslmode=verify-full");
  });

  test("leaves a malformed URL to the driver", () => {
    expect(databaseTlsProblem("not a url")).toBeNull();
  });
});

describe("cookieNameProblem", () => {
  test("accepts a __Host- name", () => {
    expect(cookieNameProblem("__Host-myapp_session")).toBeNull();
  });

  test("suggests the prefixed form of a bare name", () => {
    expect(cookieNameProblem("myapp_session")).toContain(
      "__Host-myapp_session",
    );
  });
});
