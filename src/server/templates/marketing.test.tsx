import { describe, expect, test } from "bun:test";
import { render } from "preact-render-to-string";
import type { MarketingPageContent } from "../cms/marketing-page";
import { Marketing } from "./marketing";

const seo = {
  title: "Pricing",
  description: "What Billet costs",
  canonicalPath: "/pricing",
  socialImage: null,
};

const hero: NonNullable<MarketingPageContent["hero"]> = {
  tag: "Pricing",
  heading: "Free, forever",
  body: "No seats, no tiers.",
  actions: [
    { label: "Start", href: "/start", newTab: false },
    { label: "Docs", href: "https://example.com/docs", newTab: true },
  ],
};

const content: MarketingPageContent = {
  hero,
  sections: [
    { type: "prose", heading: "Why", html: "<p>Because.</p>" },
    {
      type: "fullImage",
      html: '<picture><img src="https://media.example.com/a.jpg" alt="A"></picture>',
      caption: "The team",
    },
    {
      type: "ctaBanner",
      heading: "Ready?",
      body: null,
      action: { label: "Sign up", href: "/signup", newTab: false },
    },
  ],
};

describe("Marketing page", () => {
  test("renders the hero first, then the sections in order", () => {
    const html = render(<Marketing seo={seo} content={content} user={null} />);

    const order = [
      "<h1>Free, forever</h1>",
      "<h2>Why</h2><div><p>Because.</p></div>",
      '<img src="https://media.example.com/a.jpg" alt="A">',
      "<figcaption>The team</figcaption>",
      "<h2>Ready?</h2>",
    ].map((fragment) => html.indexOf(fragment));

    expect(order.every((position) => position >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test("styles the first hero button primary and the rest ghost", () => {
    const html = render(<Marketing seo={seo} content={content} user={null} />);

    expect(html).toContain('<a href="/start" class="btn-primary">Start</a>');
    expect(html).toContain(
      '<a href="https://example.com/docs" class="btn-ghost" target="_blank" rel="noopener noreferrer">Docs</a>',
    );
  });

  test("leaves out the button row when no hero button resolved", () => {
    const html = render(
      <Marketing
        seo={seo}
        content={{ ...content, hero: { ...hero, actions: [] } }}
        user={null}
      />,
    );

    expect(html).toContain("<h1>Free, forever</h1>");
    expect(html).not.toContain("hero-actions");
  });

  test("keeps a CTA banner's words when its button didn't resolve", () => {
    const html = render(
      <Marketing
        seo={seo}
        content={{
          hero,
          sections: [
            { type: "ctaBanner", heading: "Ready?", body: "Go", action: null },
          ],
        }}
        user={null}
      />,
    );

    expect(html).toContain(
      '<section class="marketing-cta"><h2>Ready?</h2><p>Go</p></section>',
    );
  });

  test("uses the page's canonical path", () => {
    const html = render(<Marketing seo={seo} content={content} user={null} />);

    expect(html).toContain('/pricing"');
    expect(html).toContain("<title>Pricing</title>");
  });
});
