import { describe, expect, test } from "bun:test";
import { renderToString } from "preact-render-to-string";
import { CaptchaWidget } from "./captcha-widget";

const challenge = {
  salt: "test-salt",
  challenge: "deadbeef",
  expires: 1_700_000_000_000,
  maxnumber: 100_000,
  signature: "abc123",
};

describe("CaptchaWidget", () => {
  test("renders nothing when no challenge is passed", () => {
    expect(renderToString(<CaptchaWidget challenge={null} />)).toBe("");
    expect(renderToString(<CaptchaWidget />)).toBe("");
  });

  test("renders the mount, hidden field, and solver script when enabled", () => {
    const html = renderToString(<CaptchaWidget challenge={challenge} />);

    expect(html).toContain("data-captcha");
    expect(html).toContain('data-salt="test-salt"');
    expect(html).toContain('data-challenge="deadbeef"');
    expect(html).toContain('data-signature="abc123"');
    expect(html).toContain('name="captcha_solution"');
    expect(html).toContain("/assets/captcha.js");
  });

  test("never leaks the answer to the client", () => {
    const html = renderToString(<CaptchaWidget challenge={challenge} />);
    // Only the target hash and search bounds are exposed — nothing named "answer".
    expect(html).not.toContain("answer");
  });
});
