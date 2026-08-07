import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { appUrl } from "./app-url";

describe("appUrl", () => {
  const original = process.env.APP_URL;

  beforeEach(() => {
    process.env.APP_URL = "https://app.example.com";
  });

  afterAll(() => {
    if (original === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = original;
  });

  test("builds an absolute URL on the configured origin", () => {
    expect(appUrl("/auth/callback?token=abc")).toBe(
      "https://app.example.com/auth/callback?token=abc",
    );
  });

  test("keeps the port, which APP_URL is required to carry", () => {
    process.env.APP_URL = "http://localhost:3000";

    expect(appUrl("/reset-password?token=abc")).toBe(
      "http://localhost:3000/reset-password?token=abc",
    );
  });

  test("drops any path on APP_URL rather than nesting under it", () => {
    process.env.APP_URL = "https://app.example.com/ignored/";

    expect(appUrl("/auth/verify")).toBe("https://app.example.com/auth/verify");
  });
});
