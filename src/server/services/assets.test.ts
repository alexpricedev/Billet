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
import {
  getAssetUrl,
  handleAssetRequest,
  initAssets,
  isBundleFilename,
  setAssetsDirForTest,
  warnOnMissingDevBundles,
} from "./assets";

const originalNodeEnv = Bun.env.NODE_ENV;

// Never the real dist/assets: this suite deletes the directory it builds in, and
// the dev server serves the real one off disk.
const FIXTURE_DIR = "dist/.assets-test";

const writeBundles = () => {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  writeFileSync(`${FIXTURE_DIR}/main.js`, "console.log('test')");
  writeFileSync(`${FIXTURE_DIR}/captcha.js`, "console.log('captcha')");
  writeFileSync(`${FIXTURE_DIR}/main.css`, "body { color: red }");
};

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
    setAssetsDirForTest(FIXTURE_DIR);
    writeBundles();
  });

  afterAll(() => {
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
    setAssetsDirForTest(null);
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

describe("isBundleFilename", () => {
  test("recognises the bundles the build produces", () => {
    expect(isBundleFilename("main.css")).toBe(true);
    expect(isBundleFilename("main.js")).toBe(true);
    expect(isBundleFilename("captcha.js")).toBe(true);
  });

  test("rejects anything else under /assets/", () => {
    expect(isBundleFilename("does-not-exist.js")).toBe(false);
    expect(isBundleFilename("main.abc12345.js")).toBe(false);
  });
});

describe("warnOnMissingDevBundles", () => {
  const warnings: string[] = [];
  let restoreWarn: () => void;

  beforeEach(() => {
    Bun.env.NODE_ENV = "test";
    setAssetsDirForTest(FIXTURE_DIR);
    warnings.length = 0;
    const original = console.warn;
    console.warn = (message: string) => warnings.push(message);
    restoreWarn = () => {
      console.warn = original;
    };
  });

  afterEach(() => {
    restoreWarn();
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
    Bun.env.NODE_ENV = originalNodeEnv;
    setAssetsDirForTest(null);
  });

  test("says nothing when every bundle is built", async () => {
    writeBundles();
    await warnOnMissingDevBundles();

    expect(warnings).toHaveLength(0);
  });

  test("names the missing bundles and the command that restores them", async () => {
    writeBundles();
    rmSync(`${FIXTURE_DIR}/main.css`);

    await warnOnMissingDevBundles();

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("main.css");
    expect(warnings[0]).toContain("bun run build");
  });

  test("treats a bundle left empty by a broken build as missing", async () => {
    writeBundles();
    writeFileSync(`${FIXTURE_DIR}/main.js`, "");

    await warnOnMissingDevBundles();

    expect(warnings[0]).toContain("main.js");
  });

  test("stays quiet in production, where initAssets throws instead", async () => {
    Bun.env.NODE_ENV = "production";

    await warnOnMissingDevBundles();

    expect(warnings).toHaveLength(0);
  });
});
