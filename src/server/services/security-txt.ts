import { siteUrl } from "./seo";

// Builds the /.well-known/security.txt body per RFC 9116. Required fields are
// Contact and Expires; the rest are optional hardening.

// RFC 9116 requires Expires to be a single ISO 8601 timestamp roughly a year
// out. Computed once at process start so it stays stable for a deploy's
// lifetime, and refreshes on every restart so it never silently lapses.
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
export const SECURITY_TXT_EXPIRES = new Date(
  Date.now() + ONE_YEAR_MS,
).toISOString();

// The Contact field comes from the SECURITY_CONTACT env var so it can be set
// per environment without editing code. A bare email is wrapped in `mailto:`;
// an already-qualified URI (mailto:, https:, tel:) is used verbatim. With no
// env set, falls back to a placeholder derived from the site host — replace it
// with a monitored mailbox or report-form URL before going live.
const resolveContact = (): string => {
  const configured = process.env.SECURITY_CONTACT?.trim();
  if (!configured) {
    // Resolved here rather than at module scope: siteUrl() reads the environment
    // on every call, and a const captured at import would freeze the origin.
    return `mailto:security@${new URL(siteUrl()).host}`;
  }
  return /^(mailto:|https:|tel:)/i.test(configured)
    ? configured
    : `mailto:${configured}`;
};

export const buildSecurityTxt = (): string =>
  [
    `Contact: ${resolveContact()}`,
    `Expires: ${SECURITY_TXT_EXPIRES}`,
    `Canonical: ${siteUrl()}/.well-known/security.txt`,
    "Preferred-Languages: en",
    "",
  ].join("\n");
