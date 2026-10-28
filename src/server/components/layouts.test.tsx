import { describe, expect, test } from "bun:test";
import { renderToString } from "preact-render-to-string";
import { Layout } from "./layouts";

describe("Layout", () => {
  const html = renderToString(
    <Layout title="Test" name="test" user={null}>
      <p>body</p>
    </Layout>,
  );

  // Every script the layout loads is same-origin, which is what lets the CSP
  // keep its script allowlist to 'self'. The marketing page's Lottie player
  // was the only third-party-shaped script and it left with the sales site.
  test("loads no cross-origin script", () => {
    expect(html).not.toMatch(/<script[^>]*src="https?:/);
    expect(html).toMatch(/<script type="module" src="\/assets\/main\.js"/);
  });

  test("follows the OS colour scheme rather than pinning dark", () => {
    expect(html).toContain("color-scheme:light dark");
    expect(html).toContain('content="light dark"');
    expect(html).toMatch(/media="\(prefers-color-scheme: dark\)"/);
  });
});
