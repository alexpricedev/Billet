import { AUTH_MODES, isAuthMode } from "../services/auth-mode";
import { log } from "../services/logger";
import {
  isOrganisationsFlag,
  ORGANISATIONS_FLAGS,
} from "../services/organisations-mode";

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

  // ORGANISATIONS_ENABLED is optional and defaults to off. Fatal on a typo for the
  // same reason as AUTH_MODE: "yes" or "1" would fall through to off, and an app
  // that silently stops grouping users into organisations is serving a different
  // data model than whoever set the variable believes it is.
  if (
    process.env.ORGANISATIONS_ENABLED !== undefined &&
    !isOrganisationsFlag(process.env.ORGANISATIONS_ENABLED)
  ) {
    log.error(
      "env",
      `ORGANISATIONS_ENABLED must be one of: ${ORGANISATIONS_FLAGS.join(", ")} (got "${process.env.ORGANISATIONS_ENABLED}")`,
    );
    process.exit(1);
  }

  if (process.env.ORGANISATIONS_ENABLED === "true") {
    log.info("env", "Organisation memberships enabled (one per user)");
  }

  // CAPTCHA_ENABLED is optional and self-contained: the proof-of-work captcha signs
  // challenges with the already-required CRYPTO_PEPPER, so there is no new secret to
  // conditionally require. Just surface that it's on.
  if (process.env.CAPTCHA_ENABLED === "true") {
    log.info("env", "Login captcha enabled (proof-of-work)");
  }

  log.info("env", "Environment variables validated");
}
