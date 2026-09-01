// The one place test environment variables are set.
//
// `bunfig.toml` preloads this for every test file, and a preload module runs
// before the test file's own module graph is evaluated. That is what makes it
// the only workable place: ESM hoists a file's imports above the first line of
// its body, so a test that assigns `process.env.SESSION_COOKIE_NAME` at the top
// is already too late — `services/sessions.ts` read it as it was imported.
// `utils/crypto.ts` captures CRYPTO_PEPPER the same way.
//
// Preload also means these values hold however the suite is started: `bun run
// test`, `test:file`, `test:coverage`, or an editor's run-test button. The
// alternative — a runner that spawns each file with an env of its own — only
// covers the one entry point, and Bun loads the developer's `.env` for the
// others, which is exactly the leak this prevents.
//
// So `.env.test` carries DATABASE_URL and nothing else. That is the one value
// that has to vary per machine, and per Conductor workspace (see
// `scripts/workspace.ts` — two agents sharing a test database truncate each
// other's tables mid-run). Everything else only ever wants one value under
// test, and wants it whether or not the developer has an `.env` at all.

import { workerDatabaseUrl } from "./worker-database";

// Assigned, not defaulted. A developer running the dev server in password mode,
// with the captcha on, or with teams enabled has those in `.env`, and Bun has
// already loaded it by the time this runs — deferring to it would reintroduce
// the leak. Tests that exercise a non-default set the variable per case at
// runtime, which happens long after preload.
const TEST_ENV: Record<string, string> = {
  // Tests hardcode `session_id=` when they build a cookie header.
  SESSION_COOKIE_NAME: "session_id",

  // The three optional features, at the defaults the app ships with. Files that
  // cover password mode, the captcha or teams flip these themselves per case.
  AUTH_MODE: "magic-link",
  CAPTCHA_ENABLED: "false",
  TEAMS_ENABLED: "false",
  TRUST_PROXY: "false",

  // Tests build request URLs as http://localhost:3000, and `services/csrf.ts`
  // compares the request Origin against APP_URL: the two disagreeing 403s every
  // form post. Pinned rather than inherited so a workspace's own port can't
  // reach the suite.
  PORT: "3000",
  APP_URL: "http://localhost:3000",

  // Required by the app at runtime. Nothing asserts these literals — the email
  // tests compare against `process.env` — they only need to be present and the
  // same on every machine.
  APP_NAME: "Test App",
  EMAIL_PROVIDER: "console",
  FROM_EMAIL: "test@example.com",
  FROM_NAME: "Test",

  // Hashes are only stable within one pepper, and a real one has no business in
  // a test run.
  CRYPTO_PEPPER: "test-pepper-do-not-use-in-production",
};

for (const [key, value] of Object.entries(TEST_ENV)) {
  process.env[key] = value;
}

// DATABASE_URL is the one variable this file does not pin, only rewrite: under
// `bun test --parallel` each worker needs its own database, because every file
// truncates every table. See `worker-database.ts` for why worker 1 keeps the
// base name, and why this has to happen in a preload rather than in the runner —
// `services/database.ts` builds its pool from DATABASE_URL as it is imported,
// which is after preload and before any test body.
if (process.env.DATABASE_URL) {
  process.env.DATABASE_URL = workerDatabaseUrl(
    process.env.DATABASE_URL,
    process.env.BUN_TEST_WORKER_ID,
  );
}
