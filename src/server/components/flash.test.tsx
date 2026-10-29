import { describe, expect, test } from "bun:test";
import { renderToString } from "preact-render-to-string";
import { Flash } from "./flash";
import type { BannerTone } from "./tone";

const tones: Array<{ tone: BannerTone; role: "status" | "alert" }> = [
  { tone: "success", role: "status" },
  { tone: "info", role: "status" },
  { tone: "warning", role: "status" },
  { tone: "danger", role: "alert" },
];

describe("Flash", () => {
  for (const { tone, role } of tones) {
    // Only an error interrupts: the other three are announced politely so a
    // screen reader isn't cut off mid-sentence by a success message.
    test(`renders the ${tone} tone as role="${role}"`, () => {
      const html = renderToString(<Flash tone={tone} title="Saved." />);

      expect(html).toContain('class="flash"');
      expect(html).toContain(`data-tone="${tone}"`);
      expect(html).toContain(`role="${role}"`);
    });
  }

  // The tone shows in the tint, the border and the icon's *shape* — so the
  // four states stay apart for a reader who can't tell the colours apart.
  test("gives each tone its own icon", () => {
    const shapes = new Set(
      tones.map(({ tone }) => {
        const html = renderToString(<Flash tone={tone} title="Saved." />);
        return html.slice(html.indexOf("<svg"), html.indexOf("</svg>"));
      }),
    );

    expect(shapes.size).toBe(tones.length);
  });

  test("hides both icons from assistive tech", () => {
    const html = renderToString(<Flash tone="success" title="Saved." />);

    expect(html.match(/aria-hidden="true"/g)).toHaveLength(2);
  });

  // The × ships hidden so a page with no bundle — every error page — doesn't
  // render a control that does nothing. flash-dismiss.ts reveals it.
  test("ships the dismiss button hidden and labelled", () => {
    const html = renderToString(<Flash tone="success" title="Saved." />);

    expect(html).toContain("data-flash-dismiss");
    expect(html).toContain('aria-label="Dismiss"');
    expect(html).toMatch(/<button[^>]*hidden/);
  });

  test("renders a title, detail, actions and field links", () => {
    const html = renderToString(
      <Flash
        tone="danger"
        title="Couldn't save."
        detail="Fix these 2 fields and try again:"
        actions={[
          { href: "/forgot-password", label: "Set your password" },
          { href: "https://example.com", label: "Docs", newTab: true },
        ]}
        fields={[
          { id: "email", label: "Email address" },
          { label: "Something with nothing to link to" },
        ]}
      />,
    );

    expect(html).toContain('class="flash-title"');
    expect(html).toContain("Couldn't save.");
    expect(html).toContain('class="flash-detail"');
    expect(html).toContain('class="flash-actions"');
    expect(html).toContain('href="/forgot-password"');
    // Only the link that leaves the app opens a new tab, and it carries rel.
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
    expect(html).toContain('class="flash-fields"');
    expect(html).toContain('href="#email"');
    // A field with no id is a line of text, not a dead link.
    expect(html).toContain("Something with nothing to link to");
  });

  test("omits every optional part when it has only a title", () => {
    const html = renderToString(<Flash tone="info" title="Heads up." />);

    expect(html).not.toContain("flash-detail");
    expect(html).not.toContain("flash-actions");
    expect(html).not.toContain("flash-fields");
  });

  test("renders children between the detail and the actions", () => {
    const html = renderToString(
      <Flash tone="success" title="Check your email!" detail="We sent a link.">
        <p>For testing: check the server console.</p>
      </Flash>,
    );

    expect(html.indexOf("We sent a link.")).toBeLessThan(
      html.indexOf("check the server console."),
    );
  });
});
