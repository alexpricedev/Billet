import { describe, expect, test } from "bun:test";
import { SITEMAP_PATHS, siteUrl } from "../../services/seo";
import { sitemap } from "./sitemap";

describe("Sitemap Controller", () => {
  test("serves valid XML with the correct content type", async () => {
    const response = sitemap.index();
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/xml; charset=utf-8",
    );
    expect(body).toStartWith('<?xml version="1.0" encoding="UTF-8"?>');
    expect(body).toContain(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    );
  });

  test("lists every public path as an absolute URL under the site origin", async () => {
    const body = await sitemap.index().text();

    for (const path of SITEMAP_PATHS) {
      const loc = new URL(path, siteUrl()).href;
      expect(body).toContain(`<loc>${loc}</loc>`);
    }
  });

  test("omits private and non-indexable routes", async () => {
    const body = await sitemap.index().text();

    expect(body).not.toContain("/admin");
    expect(body).not.toContain("/login");
    expect(body).not.toContain("/api/");
  });
});
