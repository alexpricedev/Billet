import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { getAssetUrl, handleAssetRequest, initAssets } from "./assets";

const originalNodeEnv = Bun.env.NODE_ENV;

describe("assets (non-production)", () => {
  beforeEach(() => {
    Bun.env.NODE_ENV = "test";
  });

  afterEach(() => {
    Bun.env.NODE_ENV = originalNodeEnv;
  });

  test("initAssets is a no-op", async () => {
    await expect(initAssets()).resolves.toBeUndefined();
  });

  test("getAssetUrl returns path unchanged", () => {
    expect(getAssetUrl("/assets/main.js")).toBe("/assets/main.js");
  });

  test("handleAssetRequest returns null", () => {
    const url = new URL("http://localhost/assets/main.abc12345.js");
    expect(handleAssetRequest(url)).toBeNull();
  });
});

describe("assets (production)", () => {
  beforeAll(() => {
    mkdirSync("dist/assets", { recursive: true });
    writeFileSync("dist/assets/main.js", "console.log('test')");
    writeFileSync("dist/assets/main.css", "body { color: red }");
  });

  afterAll(() => {
    rmSync("dist/assets", { recursive: true, force: true });
  });

  beforeEach(async () => {
    Bun.env.NODE_ENV = "production";
    await initAssets();
  });

  afterEach(() => {
    Bun.env.NODE_ENV = originalNodeEnv;
  });

  test("getAssetUrl returns hashed path after init", () => {
    const result = getAssetUrl("/assets/main.js");
    expect(result).toMatch(/^\/assets\/main\.[a-f0-9]{8}\.js$/);
  });

  test("getAssetUrl returns hashed css path", () => {
    const result = getAssetUrl("/assets/main.css");
    expect(result).toMatch(/^\/assets\/main\.[a-f0-9]{8}\.css$/);
  });

  test("getAssetUrl returns path unchanged for unknown file", () => {
    expect(getAssetUrl("/assets/unknown.js")).toBe("/assets/unknown.js");
  });

  test("getAssetUrl returns path unchanged when no filename", () => {
    expect(getAssetUrl("/")).toBe("/");
  });

  test("handleAssetRequest serves js with cache headers", () => {
    const hashedUrl = getAssetUrl("/assets/main.js");
    const url = new URL(`http://localhost${hashedUrl}`);
    const response = handleAssetRequest(url);

    expect(response).not.toBeNull();
    expect(response?.headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(response?.headers.get("Content-Type")).toBe(
      "application/javascript",
    );
  });

  test("handleAssetRequest serves css with correct content type", () => {
    const hashedUrl = getAssetUrl("/assets/main.css");
    const url = new URL(`http://localhost${hashedUrl}`);
    const response = handleAssetRequest(url);

    expect(response).not.toBeNull();
    expect(response?.headers.get("Content-Type")).toBe("text/css");
  });

  test("handleAssetRequest returns 404 for wrong hash", () => {
    const url = new URL("http://localhost/assets/main.00000000.js");
    const response = handleAssetRequest(url);

    expect(response).not.toBeNull();
    expect(response?.status).toBe(404);
  });

  test("handleAssetRequest returns null for non-matching path", () => {
    const url = new URL("http://localhost/other/path");
    expect(handleAssetRequest(url)).toBeNull();
  });
});
