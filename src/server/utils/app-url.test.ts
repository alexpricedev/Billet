import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { appOrigin, appUrl } from "./app-url";

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

describe("appOrigin", () => {
  const original = process.env.APP_URL;

  afterAll(() => {
    if (original === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = original;
  });

  test("reduces APP_URL to scheme, host and port", () => {
    process.env.APP_URL = "https://app.example.com/ignored/?x=1";

    expect(appOrigin()).toBe("https://app.example.com");
  });

  // The reason it is a function: siteUrl() in services/seo.ts falls back to it,
  // and a value captured at import would freeze the origin every page renders.
  test("reflects APP_URL changed after the module loaded", () => {
    process.env.APP_URL = "https://first.example";
    expect(appOrigin()).toBe("https://first.example");

    process.env.APP_URL = "https://second.example";
    expect(appOrigin()).toBe("https://second.example");
  });
});
