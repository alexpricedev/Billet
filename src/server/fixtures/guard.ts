/**
 * Refuse to run a fixture command against production.
 *
 * Fixtures truncate every table and `persona-session` mints sessions for fixed,
 * publicly documented accounts — either is a hole in a real deployment. Called
 * before the database module is imported, because that import throws without
 * `DATABASE_URL` and would hide the refusal behind a different error.
 */
export const assertNotProduction = (
  scriptName: string,
  reason: string,
): void => {
  if (process.env.NODE_ENV !== "production") return;
  console.error(
    `${scriptName} refuses to run with NODE_ENV=production: ${reason}`,
  );
  process.exit(1);
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Refuse to run against a database that isn't on this machine.
 *
 * `NODE_ENV` is usually unset on a laptop, so a `.env` pointing at a hosted
 * database passes `assertNotProduction`. `FIXTURES_ALLOW_REMOTE=1` is the
 * explicit override. Same ordering rule: before the database module is imported.
 */
export const assertLocalDatabase = (scriptName: string): void => {
  if (process.env.FIXTURES_ALLOW_REMOTE === "1") return;
  let host: string;
  try {
    host = new URL(process.env.DATABASE_URL ?? "").hostname;
  } catch {
    console.error(
      `${scriptName} refuses to run: DATABASE_URL is missing or cannot be parsed, so its host cannot be checked. Set FIXTURES_ALLOW_REMOTE=1 to override.`,
    );
    process.exit(1);
  }
  if (LOCAL_HOSTS.has(host)) return;
  console.error(
    `${scriptName} refuses to run: DATABASE_URL host "${host}" is not localhost, 127.0.0.1 or ::1. Set FIXTURES_ALLOW_REMOTE=1 to override.`,
  );
  process.exit(1);
};
