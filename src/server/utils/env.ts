import { log } from "../services/logger";

interface EnvConfig {
  required: string[];
  optional: string[];
}

const config: EnvConfig = {
  required: ["DATABASE_URL", "CRYPTO_PEPPER"],
  optional: ["PORT", "APP_NAME", "APP_ORIGIN", "FROM_EMAIL", "FROM_NAME"],
};

export function validateEnv(): void {
  const missing: string[] = [];
  const warnings: string[] = [];

  for (const key of config.required) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }

  for (const key of config.optional) {
    if (!process.env[key]) {
      warnings.push(key);
    }
  }

  if (warnings.length > 0) {
    log.warn("env", `Optional variables not set: ${warnings.join(", ")}`);
  }

  if (missing.length > 0) {
    log.error("env", `Missing required variables: ${missing.join(", ")}`);
    log.error(
      "env",
      "Set these in your .env file or environment before starting the server",
    );
    process.exit(1);
  }

  log.info("env", "Environment variables validated");
}
