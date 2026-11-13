import { AUTH_MODES, isAuthMode } from "../services/auth-mode";
import { devLoginProblem } from "../services/dev-login";
import { log } from "../services/logger";
import { isTeamsFlagValue, TEAMS_FLAG_VALUES } from "../services/teams-mode";

const REQUIRED = [
  "DATABASE_URL",
  "CRYPTO_PEPPER",
  "PORT",
  "APP_NAME",
  "APP_URL",
  "EMAIL_PROVIDER",
  "FROM_EMAIL",
  "FROM_NAME",
];

// APP_URL and SITE_URL are both parsed with `new URL()` at request time, so a
// malformed value is a throw on every page render rather than a warning. The
// protocol check is not pedantry: `new URL("mailto:x")` parses happily and its
// `.origin` is the literal string "null", which would ship canonicals reading
// "null/stack". In production `http:` is rejected too — a plaintext canonical is
// a duplicate-content and mixed-content signal, and the emailed links built from
// the same origin would go out unencrypted. Dev and test stay on http://localhost.
//
// Exported so the rule can be tested directly: validateEnv() answers a bad value
// with process.exit(1), which a test can't call without taking the runner down.
export const urlProblem = (key: string, value: string): string | null => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return `${key} must be an absolute URL including the scheme (got "${value}")`;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return `${key} must use http:// or https:// (got "${value}")`;
  }

  if (parsed.protocol === "http:" && process.env.NODE_ENV === "production") {
    return `${key} must use https:// in production (got "${value}")`;
  }

  return null;
};

// CRYPTO_PEPPER keys every HMAC in the app — session id hashes, CSRF secrets,
// magic-link and reset tokens, the dev sign-in links. Presence used to be the
// only check, so a one-character value or the .env.example placeholder booted
// and keyed all of that off a guessable string. 32 characters is the floor
// (`bun run generate:pepper` emits 64); the placeholder is refused by name so
// it can't slip through by being long enough.
export const PEPPER_MIN_LENGTH = 32;
const PEPPER_PLACEHOLDER = "something-random";

export const pepperProblem = (value: string): string | null => {
  if (value === PEPPER_PLACEHOLDER) {
    return "CRYPTO_PEPPER is still the .env.example placeholder — run `bun run generate:pepper`";
  }
  if (value.length < PEPPER_MIN_LENGTH) {
    return `CRYPTO_PEPPER must be at least ${PEPPER_MIN_LENGTH} characters (got ${value.length}) — run \`bun run generate:pepper\``;
  }
  return null;
};

// A database on another host is reached over a network, and without `sslmode`
// in the URL the driver connects in plaintext: every session hash, email and
// password hash crosses that network readable. A warning rather than a refusal,
// because a database alone with the app on a private network is a legitimate
// choice — and `sslmode=disable` written into the URL says it was one, which is
// the difference between a decision and an oversight. Local sockets and
// loopback never leave the machine and are exempt.
const LOCAL_DATABASE_HOSTS = new Set(["", "localhost", "127.0.0.1", "[::1]"]);

export const databaseTlsProblem = (url: string): string | null => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // The driver reports a malformed URL in its own words at connect time.
    return null;
  }
  if (LOCAL_DATABASE_HOSTS.has(parsed.hostname)) {
    return null;
  }
  if (parsed.searchParams.has("sslmode")) {
    return null;
  }
  return `DATABASE_URL connects to ${parsed.hostname} without sslmode — traffic to the database is unencrypted. Add ?sslmode=verify-full, or sslmode=disable to record that plaintext on this network is deliberate`;
};

// The session cookie is the credential, and a `__Host-` name is the browser's
// guarantee that it was set by this origin over HTTPS with Path=/ and no
// Domain — so a compromised or sibling subdomain can't plant one (session
// fixation by cookie tossing). The default name carries the prefix in
// production; an operator who sets their own name is told when it doesn't.
export const COOKIE_HOST_PREFIX = "__Host-";

export const cookieNameProblem = (name: string): string | null =>
  name.startsWith(COOKIE_HOST_PREFIX)
    ? null
    : `SESSION_COOKIE_NAME "${name}" lacks the ${COOKIE_HOST_PREFIX} prefix, so a subdomain could set a session cookie for this host — prefer ${COOKIE_HOST_PREFIX}${name}`;

export function validateEnv(): void {
  const isProduction = process.env.NODE_ENV === "production";
  const missing: string[] = [];

  for (const key of REQUIRED) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }

  if (process.env.EMAIL_PROVIDER === "resend" && !process.env.RESEND_API_KEY) {
    missing.push("RESEND_API_KEY");
  }

  if (missing.length > 0) {
    log.error("env", `Missing required variables: ${missing.join(", ")}`);
    log.error(
      "env",
      "Set these in your .env file or environment before starting the server",
    );
    process.exit(1);
  }

  if (
    process.env.EMAIL_PROVIDER === "resend" &&
    (process.env.FROM_EMAIL as string).endsWith("@example.com")
  ) {
    log.error(
      "env",
      "FROM_EMAIL is still the @example.com placeholder — Resend will reject it or it will land in spam",
    );
    log.error(
      "env",
      "Set FROM_EMAIL to an address on a Resend-verified domain (see runbooks/EMAIL.md)",
    );
    process.exit(1);
  }

  // A weak pepper is fatal where it matters and loud everywhere else: a dev
  // checkout with a short value keeps booting, but says so on every start.
  const pepperIssue = pepperProblem(process.env.CRYPTO_PEPPER as string);
  if (pepperIssue) {
    if (isProduction) {
      log.error("env", pepperIssue);
      process.exit(1);
    }
    log.warn("env", pepperIssue);
  }

  if (isProduction) {
    const tlsIssue = databaseTlsProblem(process.env.DATABASE_URL as string);
    if (tlsIssue) {
      log.warn("env", tlsIssue);
    }

    const configuredCookieName = process.env.SESSION_COOKIE_NAME;
    const cookieIssue = configuredCookieName
      ? cookieNameProblem(configuredCookieName)
      : null;
    if (cookieIssue) {
      log.warn("env", cookieIssue);
    }
  }

  // APP_URL is the origin CSRF validation compares against, the base for every
  // emailed link, and — via siteUrl() in services/seo.ts — the canonical origin
  // for canonicals, Open Graph tags, the sitemap and JSON-LD. One bad value now
  // breaks all three, so it is fatal at boot rather than at first render.
  const appUrlProblem = urlProblem("APP_URL", process.env.APP_URL as string);
  if (appUrlProblem) {
    log.error("env", appUrlProblem);
    process.exit(1);
  }

  // SITE_URL is optional: absent means the canonical origin follows APP_URL,
  // which is right unless the marketing domain and the app domain differ. Set,
  // it is held to the same rule. Blank counts as absent, matching siteUrl() —
  // an empty value is what a copied-out `SITE_URL=` line or a variable cleared
  // on a host that keeps the key leaves behind, and refusing to boot over it
  // would contradict the fallback the rest of the code already applies.
  const configuredSiteUrl = process.env.SITE_URL?.trim();
  if (configuredSiteUrl) {
    const siteUrlProblem = urlProblem("SITE_URL", configuredSiteUrl);
    if (siteUrlProblem) {
      log.error("env", siteUrlProblem);
      process.exit(1);
    }
  }

  // AUTH_MODE is optional and defaults to magic-link. A typo would otherwise fall
  // through to that default silently, so a value outside the set is fatal — booting
  // with the wrong credential type is worse than not booting at all.
  if (
    process.env.AUTH_MODE !== undefined &&
    !isAuthMode(process.env.AUTH_MODE)
  ) {
    log.error(
      "env",
      `AUTH_MODE must be one of: ${AUTH_MODES.join(", ")} (got "${process.env.AUTH_MODE}")`,
    );
    process.exit(1);
  }

  if (process.env.AUTH_MODE === "password") {
    log.info("env", "Auth mode: password (email + password credentials)");
  }

  // TEAMS_ENABLED is optional and off by default. Unlike CAPTCHA_ENABLED, a
  // typo here is worth refusing to boot over: a value outside the set silently
  // 404s the whole team surface, and an owner hitting a 404 on their own team
  // page reads that as a bug rather than as a mode.
  if (
    process.env.TEAMS_ENABLED !== undefined &&
    !isTeamsFlagValue(process.env.TEAMS_ENABLED)
  ) {
    log.error(
      "env",
      `TEAMS_ENABLED must be one of: ${TEAMS_FLAG_VALUES.join(", ")} (got "${process.env.TEAMS_ENABLED}")`,
    );
    process.exit(1);
  }

  if (process.env.TEAMS_ENABLED === "true") {
    log.info("env", "Team management enabled (org invites, roles, members)");
  }

  // TRUST_PROXY decides whose word the rate limiter takes for the client
  // address (see middleware/client-ip.ts). A typo is worth refusing to boot
  // over for the same reason as TEAMS_ENABLED: "ture" silently means "off",
  // and off behind a proxy collapses every client into one rate-limit bucket.
  if (
    process.env.TRUST_PROXY !== undefined &&
    !["true", "false"].includes(process.env.TRUST_PROXY)
  ) {
    log.error(
      "env",
      `TRUST_PROXY must be one of: true, false (got "${process.env.TRUST_PROXY}")`,
    );
    process.exit(1);
  }

  if (process.env.TRUST_PROXY === "true") {
    log.info(
      "env",
      "Trusting x-forwarded-for from the proxy for rate limiting",
    );
  }

  // DEV_LOGIN is optional and off by default. Beyond the usual typo check it
  // is fatal in production and against a database that isn't on this machine:
  // it hands out a platform admin session without a credential, so a deploy
  // that inherited the flag must not come up at all.
  const devLoginIssue = devLoginProblem();
  if (devLoginIssue) {
    log.error("env", devLoginIssue);
    process.exit(1);
  }

  if (process.env.DEV_LOGIN === "true") {
    log.detail("env", "Dev sign-in links enabled (printed at startup)");
  }

  // CAPTCHA_ENABLED is optional and self-contained: the proof-of-work captcha signs
  // challenges with the already-required CRYPTO_PEPPER, so there is no new secret to
  // conditionally require. Just surface that it's on.
  if (process.env.CAPTCHA_ENABLED === "true") {
    log.info("env", "Login captcha enabled (proof-of-work)");
  }

  log.detail("env", "Environment variables validated");
}
