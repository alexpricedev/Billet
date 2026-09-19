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
  // indexed because of what was left unset.
  test("drops the sitemap but keeps crawling open while indexing is off", async () => {
    const body = await robotsTxt.index().text();

    // No Sitemap line: nothing to advertise on a host that isn't indexable.
    expect(body).not.toContain("Sitemap:");
    // Crawling itself stays allowed, because `noindex` is what keeps the site
    // out of the index and a crawler has to fetch a page to read it. A
    // `Disallow: /` here would block the fetch and strand the noindex — and
    // would not prevent indexing on its own, since a linked-to URL gets
    // indexed unfetched.
    expect(body).toContain("Allow: /");
    expect(body).not.toContain("Disallow: /\n");
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
