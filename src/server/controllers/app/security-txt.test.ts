import { describe, expect, test } from "bun:test";
import { SITE_URL } from "../../services/seo";
import { securityTxt } from "./security-txt";

describe("Security.txt Controller", () => {
  test("serves plain text with the correct content type", async () => {
    const response = securityTxt.index();
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );
    expect(body).toContain("Contact: mailto:security@");
  });

  test("includes the RFC 9116 required Expires field as an ISO 8601 timestamp", async () => {
    const body = await securityTxt.index().text();

    const match = body.match(/^Expires: (.+)$/m);
    expect(match).not.toBeNull();
    const expires = new Date(match?.[1] ?? "");
    expect(expires.getTime()).toBeGreaterThan(Date.now());
  });

  test("points Canonical at the well-known path under SITE_URL", async () => {
    const body = await securityTxt.index().text();

    expect(body).toContain(`Canonical: ${SITE_URL}/.well-known/security.txt`);
  });
});
