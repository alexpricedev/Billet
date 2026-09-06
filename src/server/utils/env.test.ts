import { afterEach, describe, expect, test } from "bun:test";
import { urlProblem } from "./env";

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
