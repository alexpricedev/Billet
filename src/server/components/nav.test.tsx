import { describe, expect, test } from "bun:test";
import { renderToString } from "preact-render-to-string";
import type { User } from "../services/users";
import { Nav } from "./nav";

const user: User = {
  id: "00000000-0000-0000-0000-000000000000",
  email: "member@example.com",
  role: "user",
  created_at: new Date("2026-01-01"),
  email_verified_at: new Date("2026-01-01"),
};

describe("Nav", () => {
  test("ships the mobile toggle hidden and collapsed", () => {
    const html = renderToString(<Nav page="home" user={null} />);

    // Hidden until src/client/components/nav-menu.ts takes over — a page
    // without that script must not render a button that toggles nothing.
    expect(html).toContain("hidden");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls="nav-menu"');
    expect(html).toContain('id="nav-menu"');
  });

  test("collects the pages and the auth actions into one panel", () => {
    const html = renderToString(
      <Nav page="home" user={user} csrfToken="tok" />,
    );
    // Everything the toggle reveals lives inside the wrapper; only the button
    // itself is left outside it.
    const panel = html.slice(html.indexOf('id="nav-menu"'));

    expect(panel).toContain('href="/stack"');
    expect(panel).toContain('href="/account"');
    expect(panel).toContain('action="/auth/logout"');
    expect(html.slice(0, html.indexOf('id="nav-menu"'))).toContain(
      "nav-toggle",
    );
  });

  test("shows Login instead when signed out", () => {
    const html = renderToString(<Nav page="home" user={null} />);

    expect(html).toContain('href="/login"');
    expect(html).not.toContain('href="/account"');
  });

  test("marks the current page on its link", () => {
    const html = renderToString(<Nav page="projects" user={null} />);

    expect(html).toContain('aria-current="page"');
  });
});
