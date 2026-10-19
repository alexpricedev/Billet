import { describe, expect, test } from "bun:test";
import { renderToString } from "preact-render-to-string";
import { Layout } from "./layouts";

describe("Layout", () => {
  const html = renderToString(
    <Layout title="Test" name="test" user={null}>
      <p>body</p>
    </Layout>,
  );

  test("loads Lottie from its own /assets, async with no cross-origin script", () => {
    expect(html).toMatch(/<script async[^>]*src="\/assets\/lottie\.js"/);
    expect(html).not.toMatch(/<script[^>]*src="https?:/);
  });
});
