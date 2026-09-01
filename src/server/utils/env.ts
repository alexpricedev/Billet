import { AUTH_MODES, isAuthMode } from "../services/auth-mode";
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

export function validateEnv(): void {
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

  // CAPTCHA_ENABLED is optional and self-contained: the proof-of-work captcha signs
  // challenges with the already-required CRYPTO_PEPPER, so there is no new secret to
  // conditionally require. Just surface that it's on.
  if (process.env.CAPTCHA_ENABLED === "true") {
    log.info("env", "Login captcha enabled (proof-of-work)");
  }

  log.info("env", "Environment variables validated");
}
