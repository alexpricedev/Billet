import { log } from "../services/logger";

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

  // CAPTCHA_ENABLED is optional and self-contained: the proof-of-work captcha signs
  // challenges with the already-required CRYPTO_PEPPER, so there is no new secret to
  // conditionally require. Just surface that it's on.
  if (process.env.CAPTCHA_ENABLED === "true") {
    log.info("env", "Login captcha enabled (proof-of-work)");
  }

  log.info("env", "Environment variables validated");
}
