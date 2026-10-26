import { describe, expect, test } from "bun:test";
import { render } from "preact-render-to-string";
import { ForgotPassword } from "./forgot-password";
import { Login } from "./login";
import { ResetPassword } from "./reset-password";
import { Signup } from "./signup";

// The four signed-out forms, which are the ones a cross-site POST can reach.
// They render the hidden field from a token and nothing from a null — a page
// that renders no field still has to render the form, because refusing to draw
// it would turn a session that couldn't be created into a blank page rather
// than a post that fails the check.
const forms = [
  {
    name: "Login",
    action: "/login",
    withToken: (token: string | null) =>
      render(<Login mode="magic-link" csrfToken={token} />),
  },
  {
    name: "Signup",
    action: "/signup",
    withToken: (token: string | null) =>
      render(<Signup mode="magic-link" csrfToken={token} />),
  },
  {
    name: "ForgotPassword",
    action: "/forgot-password",
    withToken: (token: string | null) =>
      render(<ForgotPassword csrfToken={token} />),
  },
  {
    name: "ResetPassword",
    action: "/reset-password",
    withToken: (token: string | null) =>
      render(<ResetPassword token="a-reset-token" csrfToken={token} />),
  },
];

describe("signed-out auth forms", () => {
  for (const { name, action, withToken } of forms) {
    describe(name, () => {
      test("renders the CSRF field inside its form", () => {
        const html = withToken("nonce.atoken");

        expect(html).toContain(`action="${action}"`);
        expect(html).toContain('<input type="hidden" name="_csrf"');
        expect(html).toContain('value="nonce.atoken"');
      });

      test("renders the form but no field when there is no token", () => {
        const html = withToken(null);

        expect(html).toContain(`action="${action}"`);
        expect(html).not.toContain('name="_csrf"');
      });
    });
  }
});

// `next` is where a page sends a visitor after they sign in. It is rendered as
// a hidden field inside the form — not in the action URL — so the destination
// stays out of the Referer header when a link is followed off the page.
describe("next after sign-in", () => {
  test("renders the destination into the form", () => {
    for (const html of [
      render(<Login mode="magic-link" csrfToken={null} next="/cms/sign-in" />),
      render(<Signup mode="magic-link" csrfToken={null} next="/cms/sign-in" />),
    ]) {
      expect(html).toContain('name="next" value="/cms/sign-in"');
    }
  });

  test("renders no field when there is no destination", () => {
    for (const html of [
      render(<Login mode="magic-link" csrfToken={null} />),
      render(<Signup mode="magic-link" csrfToken={null} />),
    ]) {
      expect(html).not.toContain('name="next"');
    }
  });

  // The login and signup pages link to each other, and someone switching
  // between them still wants to land where the first link was going.
  test("carries the destination to the other signed-out form", () => {
    expect(
      render(<Login mode="magic-link" csrfToken={null} next="/cms/sign-in" />),
    ).toContain('href="/signup?next=%2Fcms%2Fsign-in"');
    expect(
      render(<Signup mode="magic-link" csrfToken={null} next="/cms/sign-in" />),
    ).toContain('href="/login?next=%2Fcms%2Fsign-in"');
  });
});
