import { describe, expect, test } from "bun:test";
import { renderToString } from "preact-render-to-string";
import type { User } from "../services/users";
import { Layout } from "./layouts";
import { VerifyBanner } from "./verify-banner";

const user = (email_verified_at: Date | null): User => ({
  id: "00000000-0000-0000-0000-000000000000",
  email: "member@example.com",
  role: "user",
  created_at: new Date("2026-01-01"),
  email_verified_at,
});

describe("VerifyBanner", () => {
  test("renders a prompt and a link to the account page when unverified", () => {
    const html = renderToString(<VerifyBanner user={user(null)} />);

    expect(html).toContain("Confirm your email address");
    expect(html).toContain('href="/account#verify-email"');
  });

  test("renders nothing once the address is confirmed", () => {
    expect(renderToString(<VerifyBanner user={user(new Date())} />)).toBe("");
  });

  test("renders nothing for a signed-out visitor", () => {
    expect(renderToString(<VerifyBanner user={null} />)).toBe("");
    expect(renderToString(<VerifyBanner />)).toBe("");
  });
});

describe("Layout banner integration", () => {
  const layout = (u: User | null) =>
    renderToString(
      <Layout title="Test" name="test" user={u}>
        <p>body</p>
      </Layout>,
    );

  test("renders the banner inside the layout while the address is unverified", () => {
    // The bar is sticky and in flow now, so there is no body offset attribute
    // to assert; what matters is that the prompt reaches the page.
    expect(layout(user(null))).toContain("Confirm your email address");
  });

  test("leaves the banner out of the layout once the address is confirmed", () => {
    expect(layout(user(new Date()))).not.toContain(
      "Confirm your email address",
    );
    expect(layout(null)).not.toContain("Confirm your email address");
  });

  test("shows an Account link only when signed in", () => {
    expect(layout(user(new Date()))).toContain('href="/account"');
    expect(layout(null)).not.toContain('href="/account"');
  });
});
