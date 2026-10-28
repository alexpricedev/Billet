import { describe, expect, test } from "bun:test";

// The theme scoping is CSS only — which token block wins is invisible to the
// DOM tests, because the client fixtures lift markup into happy-dom without a
// stylesheet. So these guard the selectors the theme depends on; the visual
// result still needs an eye on the page (`bun run test:browser`, or /browse).
const css = await Bun.file(new URL("./base.css", import.meta.url)).text();

const darkAttribute = /:root\[data-theme="dark"\]\s*\{([^}]*)\}/;
const darkMedia =
  /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{[\s\S]*?:root:not\(\[data-theme\]\)\s*\{([^}]*)\}/;

// The full `--token: value` declarations, so a value edited in one copy and not
// the other fails here too — not just a token added to one list and not the
// other.
const declarations = (block: string): string[] =>
  block
    .split(";")
    .map((declaration) => declaration.trim())
    .filter((declaration) => declaration !== "")
    .sort();

describe("base.css theme scopes", () => {
  test("light is the unqualified :root palette", () => {
    const root = /:root\s*\{([^}]*)\}/.exec(css)?.[1];
    expect(root).toBeDefined();
    expect(root).toContain("color-scheme: light dark");
    expect(root).toContain("--canvas: #fafafa");
    expect(root).toContain("--text: #171717");
  });

  // An explicit choice has to beat the OS, so these tokens cannot sit behind a
  // media query — they apply whenever something wrote the attribute.
  test('applies the dark tokens under [data-theme="dark"]', () => {
    const block = darkAttribute.exec(css)?.[1];
    expect(block).toBeDefined();
    expect(block).toContain("--canvas: #090909");
    expect(block).toContain("--text: #ededed");
    expect(block).toContain("--button-primary-bg: #ededed");
  });

  // System is the default and the only mode Billet ships, so the OS setting
  // decides — but only when no page has claimed a theme.
  test("scopes the OS dark media query to pages with no data-theme", () => {
    const media = darkMedia.exec(css)?.[1];
    expect(media).toBeDefined();
    expect(media).toContain("--canvas: #090909");
  });

  // Light needs no block at all: the unqualified `:root` tokens are the light
  // palette, and a `[data-theme="light"]` page matches neither dark selector.
  test('nothing is scoped to [data-theme="light"]', () => {
    expect(css).not.toMatch(/\[data-theme="light"\]\s*\{/);
  });

  // The two dark blocks are a deliberate duplicate — plain CSS has no way to
  // put one declaration block under both an attribute selector and a media
  // query — so a token or value changed in one has to change in the other, or
  // the OS setting and an explicit Dark drift apart.
  test("the two dark token lists agree", () => {
    const explicit = darkAttribute.exec(css)?.[1];
    const media = darkMedia.exec(css)?.[1];
    expect(explicit).toBeDefined();
    expect(media).toBeDefined();
    expect(declarations(media as string)).toEqual(
      declarations(explicit as string),
    );
  });

  // The chevron is a data URI, which cannot read a custom property, so the
  // whole url() is the token and each theme carries its own. Baking one
  // theme's stroke into the `select` rule is the defect this replaced.
  test("the select chevron is a per-theme token", () => {
    expect(css).toContain("background-image: var(--select-chevron)");
    expect(
      declarations(darkAttribute.exec(css)?.[1] as string).join(";"),
    ).toContain("--select-chevron:");
  });
});
