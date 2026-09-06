import { afterEach, describe, expect, test } from "bun:test";
import {
  absolute,
  buildRobotsTxt,
  buildSitemapXml,
  siteStructuredData,
  siteUrl,
} from "./seo";

// These tests assert against literal domains on purpose. The other SEO suites
// (sitemap, robots-txt, llms-txt, security-txt) build their expectations from
// siteUrl() itself, so they stay self-consistent whatever origin it returns —
// they would pass against a wrong one. This file is what pins the origin.

const APP_URL = process.env.APP_URL;
const SITE_URL = process.env.SITE_URL;

const restore = (key: string, value: string | undefined): void => {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
};

afterEach(() => {
  restore("APP_URL", APP_URL);
  restore("SITE_URL", SITE_URL);
});

describe("siteUrl", () => {
  test("derives the canonical origin from APP_URL", () => {
    process.env.APP_URL = "https://example.com";
    delete process.env.SITE_URL;

    expect(siteUrl()).toBe("https://example.com");
  });

  test("keeps the port, so dev canonicals match the dev server", () => {
    process.env.APP_URL = "http://localhost:3000";
    delete process.env.SITE_URL;

    expect(siteUrl()).toBe("http://localhost:3000");
  });

  test("SITE_URL overrides APP_URL", () => {
    process.env.APP_URL = "https://app.example.com";
    process.env.SITE_URL = "https://example.com";

    expect(siteUrl()).toBe("https://example.com");
  });

  test("reduces a configured value to its origin", () => {
    process.env.APP_URL = "https://app.example.com";
    process.env.SITE_URL = "https://example.com/";

    expect(siteUrl()).toBe("https://example.com");

    process.env.SITE_URL = "https://example.com/marketing?utm=x";

    expect(siteUrl()).toBe("https://example.com");
  });

  test("reduces APP_URL to its origin too", () => {
    process.env.APP_URL = "https://example.com/app/";
    delete process.env.SITE_URL;

    expect(siteUrl()).toBe("https://example.com");
  });

  test("ignores a blank SITE_URL rather than treating it as configured", () => {
    process.env.APP_URL = "https://example.com";
    process.env.SITE_URL = "   ";

    expect(siteUrl()).toBe("https://example.com");
  });

  // The regression guard: a module-level `const SITE_URL = ...` captured at
  // import would freeze the first value read and pass every test above.
  test("reflects APP_URL changed after the module loaded", () => {
    process.env.APP_URL = "https://first.example";
    delete process.env.SITE_URL;
    expect(siteUrl()).toBe("https://first.example");

    process.env.APP_URL = "https://second.example";
    expect(siteUrl()).toBe("https://second.example");
  });
});

describe("generated artefacts follow the resolved origin", () => {
  test("absolute() resolves against it", () => {
    process.env.APP_URL = "https://example.com";
    delete process.env.SITE_URL;

    expect(absolute("/og-image.png")).toBe("https://example.com/og-image.png");
  });

  test("the sitemap lists locs under it", () => {
    process.env.APP_URL = "https://app.example.com";
    process.env.SITE_URL = "https://example.com";

    const xml = buildSitemapXml();

    expect(xml).toContain("<loc>https://example.com/</loc>");
    expect(xml).not.toContain("app.example.com");
  });

  test("robots.txt points at the sitemap under it", () => {
    process.env.APP_URL = "https://example.com";
    delete process.env.SITE_URL;

    expect(buildRobotsTxt()).toContain(
      "Sitemap: https://example.com/sitemap.xml",
    );
  });

  test("the JSON-LD @id and url fields use it", () => {
    process.env.APP_URL = "https://app.example.com";
    process.env.SITE_URL = "https://example.com";

    const graph = JSON.parse(siteStructuredData())["@graph"];

    expect(graph[0]["@id"]).toBe("https://example.com/#website");
    expect(graph[0].url).toBe("https://example.com/");
    expect(graph[0].publisher["@id"]).toBe("https://example.com/#organization");
    expect(graph[1]["@id"]).toBe("https://example.com/#organization");
    expect(graph[1].url).toBe("https://example.com/");
    expect(graph[1].logo).toBe("https://example.com/og-image.png");
  });
});
