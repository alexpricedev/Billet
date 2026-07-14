import { describe, expect, test } from "bun:test";
import { buildLlmsTxt } from "./llms-txt";
import { SITE_NAME, SITE_URL, SITEMAP_PATHS } from "./seo";

describe("buildLlmsTxt", () => {
  test("opens with the H1 site name and a blockquote summary", () => {
    const body = buildLlmsTxt();

    expect(body).toStartWith(`# ${SITE_NAME}\n`);
    expect(body).toMatch(/^> .+/m);
  });

  test("groups links under Pages and Resources headings", () => {
    const body = buildLlmsTxt();

    expect(body).toContain("## Pages");
    expect(body).toContain("## Resources");
  });

  test("lists every public sitemap path as an absolute markdown link", () => {
    const body = buildLlmsTxt();

    for (const path of SITEMAP_PATHS) {
      const href = new URL(path, SITE_URL).href;
      expect(body).toContain(`](${href}):`);
    }
  });

  test("points agents at the sitemap and security policy resources", () => {
    const body = buildLlmsTxt();

    expect(body).toContain(`${SITE_URL}/sitemap.xml`);
    expect(body).toContain(`${SITE_URL}/.well-known/security.txt`);
  });
});
