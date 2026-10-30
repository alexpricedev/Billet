import { describe, expect, test } from "bun:test";
import { render } from "preact-render-to-string";
import type { HomeHeroContent } from "../cms/home-hero";
import { Home } from "./home";

const hero: HomeHeroContent = {
  tag: "Edited tag",
  heading: "Edited heading",
  body: "Edited intro",
  primaryAction: { label: "Start", href: "/start", newTab: false },
  secondaryAction: {
    label: "Docs",
    href: "https://example.com/docs",
    newTab: true,
  },
};

describe("Home hero", () => {
  test("renders the written copy until the CMS has a hero", () => {
    const html = render(<Home user={null} hero={null} />);

    expect(html).toContain("Let your agents ship, safely");
    expect(html).toContain('href="/stack"');
  });

  test("renders the CMS hero in place of the written copy", () => {
    const html = render(<Home user={null} hero={hero} />);

    expect(html).toContain("<h1>Edited heading</h1>");
    expect(html).toContain('<p class="hero-tag">Edited tag</p>');
    expect(html).toContain('<p class="hero-sub">Edited intro</p>');
    expect(html).toContain('<a href="/start" class="btn-primary">Start</a>');
    expect(html).not.toContain("Let your agents ship, safely");
  });

  test("opens a new-tab button safely", () => {
    const html = render(<Home user={null} hero={hero} />);

    expect(html).toContain(
      '<a href="https://example.com/docs" class="btn-ghost" target="_blank" rel="noopener noreferrer">Docs</a>',
    );
  });

  test("leaves the secondary button out when the CMS has none", () => {
    const html = render(
      <Home user={null} hero={{ ...hero, secondaryAction: null }} />,
    );

    expect(html).toContain(
      '<div class="hero-actions"><a href="/start" class="btn-primary">Start</a></div>',
    );
  });
});
