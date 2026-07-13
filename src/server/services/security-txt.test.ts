import { afterEach, describe, expect, test } from "bun:test";
import { buildSecurityTxt } from "./security-txt";
import { SITE_URL } from "./seo";

const host = new URL(SITE_URL).host;

describe("buildSecurityTxt", () => {
  afterEach(() => {
    delete process.env.SECURITY_CONTACT;
  });

  test("falls back to a host-derived mailto when SECURITY_CONTACT is unset", () => {
    delete process.env.SECURITY_CONTACT;
    expect(buildSecurityTxt()).toContain(`Contact: mailto:security@${host}`);
  });

  test("wraps a bare email from SECURITY_CONTACT in mailto:", () => {
    process.env.SECURITY_CONTACT = "secops@acme.test";
    expect(buildSecurityTxt()).toContain("Contact: mailto:secops@acme.test");
  });

  test("uses a mailto: URI from SECURITY_CONTACT verbatim", () => {
    process.env.SECURITY_CONTACT = "mailto:secops@acme.test";
    expect(buildSecurityTxt()).toContain("Contact: mailto:secops@acme.test");
  });

  test("uses an https: report-form URI verbatim", () => {
    process.env.SECURITY_CONTACT = "https://acme.test/security/report";
    expect(buildSecurityTxt()).toContain(
      "Contact: https://acme.test/security/report",
    );
  });

  test("always includes the required Expires and Canonical fields", () => {
    const body = buildSecurityTxt();
    expect(body).toMatch(/^Expires: .+$/m);
    expect(body).toContain(`Canonical: ${SITE_URL}/.well-known/security.txt`);
  });
});
