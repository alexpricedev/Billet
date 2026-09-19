import { afterEach, describe, expect, test } from "bun:test";
import { siteUrl } from "../../services/seo";
import { robotsTxt } from "./robots-txt";

// Indexing is closed unless ALLOW_INDEXING says otherwise, so every assertion
// about the open body has to open it first. The closed body is what an
// unconfigured host actually serves, and it gets its own test below.
const allowIndexing = (): void => {
  process.env.ALLOW_INDEXING = "true";
};

describe("robots.txt Controller", () => {
  afterEach(() => {
    delete process.env.ALLOW_INDEXING;
  });

  // The default matters more than the opt-in: a host nobody remembered to
  // configure — a preview, a staging box, a fork's first deploy — must not be
  // crawlable because of what was left unset.
  test("shuts every crawler out unless indexing is switched on", async () => {
    const body = await robotsTxt.index().text();

    expect(body).toContain("User-agent: *");
    expect(body).toContain("Disallow: /\n");
    expect(body).not.toContain("Allow: /");
    expect(body).not.toContain("Sitemap:");
    // A named group replaces the wildcard for that agent, so naming the AI
    // crawlers here would exempt each one from the blanket rule.
    expect(body).not.toContain("User-agent: GPTBot");
  });

  test("serves plain text with the correct content type", async () => {
    allowIndexing();
    const response = robotsTxt.index();
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );
    expect(body).toContain("User-agent: *");
    expect(body).toContain("Allow: /");
  });

  test("disallows private surfaces for every group", async () => {
    allowIndexing();
    const body = await robotsTxt.index().text();

    expect(body).toContain("Disallow: /admin");
    expect(body).toContain("Disallow: /account");
    expect(body).toContain("Disallow: /api/");
    expect(body).toContain("Disallow: /auth/");
  });

  test("calls out named AI crawlers explicitly", async () => {
    allowIndexing();
    const body = await robotsTxt.index().text();

    expect(body).toContain("User-agent: GPTBot");
    expect(body).toContain("User-agent: ClaudeBot");
    expect(body).toContain("User-agent: Google-Extended");
  });

  test("declares an open Content-Signal posture", async () => {
    allowIndexing();
    const body = await robotsTxt.index().text();

    expect(body).toContain(
      "Content-Signal: search=yes, ai-input=yes, ai-train=yes",
    );
  });

  test("points at the absolute sitemap URL under the site origin", async () => {
    allowIndexing();
    const body = await robotsTxt.index().text();

    expect(body).toContain(`Sitemap: ${siteUrl()}/sitemap.xml`);
  });
});
