/* biome-ignore-all lint/suspicious/noConsole: CLI script */

// The test entry point. Two things have to happen around `bun test` that it
// won't do itself, and this script is both of them.
//
// 1. **Migrations.** `bun test` runs against whatever schema is already in the
//    database, which is fine until a migration lands and every service test
//    fails on a missing column.
// 2. **NODE_ENV.** Bun picks which `.env` file to load from it at startup,
//    before any preload runs, so it cannot be set from `test-env.ts` with the
//    rest of the suite's environment.
//
// Isolation is `bun test --isolate`'s job, not this script's. It gives each
// file a fresh `globalThis` and clears the ESM and CommonJS module registries
// between files — which is what spawning one process per file used to buy — and
// then adds what that couldn't: closing servers, sockets and watchers a file
// leaked, cancelling its timers, restoring fake timers, and re-running the
// preloads in the new global. Transpiled source is cached across files, so the
// suite parses each module once rather than once per file.

import { cpus } from "node:os";
import { SQL } from "bun";
import {
  quoteIdent,
  withDatabase,
  workerDatabaseName,
  workerSlots,
} from "./worker-database";

const TIMINGS_FILE = process.env.TEST_TIMINGS_FILE ?? ".timings.json";

// A whole-run hang detector, not a speed limit. Per-test timeouts are Bun's
// (`--timeout`, 5s by default), and `--isolate` closes the handles that used to
// wedge a run, so this only catches a run that stops making progress
// altogether. Generous by default; CI raises it because a runner is slower.
const TIMEOUT_MS = Number.parseInt(process.env.TEST_TIMEOUT_MS ?? "600000", 10);

const SLOWEST_TO_REPORT = 10;

// The paths `bun test` sweeps, named rather than globbed. `scripts/` is not in
// the list: `scripts/browser-smoke.test.ts` needs a built bundle and a
// listening server, so it runs on its own through `bun run test:browser`. Any
// other test outside `src/` has to be added here by name or it never runs in
// CI, and nothing will tell you — a widened glob would drag the smoke test in
// with it.
const TEST_PATHS = ["src"];

// One worker per core by default. `TEST_WORKERS=1` runs the suite in a single
// process — no extra databases, no parallelism — which is the right setting when
// a failure needs a readable, ordered log.
const WORKERS = Math.max(
  1,
  Number.parseInt(process.env.TEST_WORKERS ?? String(cpus().length), 10) || 1,
);

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) {
  console.error(
    "DATABASE_URL is required for tests — set it in .env.test (see .env.example)",
  );
  process.exit(1);
}

/**
 * Create the databases slots 2..N will use, then migrate every one of them.
 *
 * Slot 1 uses the base database, so a single-worker run creates nothing and this
 * is exactly the migration step it always was. Creation is idempotent: the
 * databases are reused across runs, so only the first parallel run on a machine
 * pays for it.
 */
const migrateAll = async (): Promise<void> => {
  const names = [
    workerDatabaseName(baseUrl, "1"),
    ...workerSlots(WORKERS).map((slot) =>
      workerDatabaseName(baseUrl, String(slot)),
    ),
  ];

  if (names.length > 1) {
    const admin = new SQL(withDatabase(baseUrl, "postgres"), { max: 1 });
    try {
      for (const name of names.slice(1)) {
        const existing =
          await admin`SELECT 1 FROM pg_database WHERE datname = ${name}`;
        if (existing.length === 0) {
          await admin.unsafe(`CREATE DATABASE ${quoteIdent(name)}`);
          console.log(`[test] created worker database ${name}`);
        }
      }
    } finally {
      await admin.end();
    }
  }

  // In parallel: N migration processes rather than N sequential ones, since
  // after the first run they all no-op and the cost is process startup.
  const results = await Promise.all(
    names.map(async (name) => {
      const proc = Bun.spawn(
        ["bun", "run", "src/server/database/cli.ts", "up"],
        {
          env: {
            ...process.env,
            NODE_ENV: "test",
            DATABASE_URL: withDatabase(baseUrl, name),
          },
          stdout: "pipe",
          stderr: "inherit",
        },
      );
      return (await proc.exited) === 0;
    }),
  );

  if (results.some((ok) => !ok)) {
    console.error("Migration failed");
    process.exit(1);
  }
};

await migrateAll();

// `--update-timings` records how long each file took, slowest first. That is
// the report printed below, and it is what `--shard` and `--parallel` read to
// balance by wall time rather than file count.
const tests = Bun.spawn(
  [
    "bun",
    "test",
    // `--parallel` implies `--isolate`; passing it explicitly keeps the
    // single-worker case isolated too.
    "--isolate",
    ...(WORKERS > 1 ? [`--parallel=${WORKERS}`] : []),
    "--no-coverage",
    `--timings=${TIMINGS_FILE}`,
    "--update-timings",
    ...TEST_PATHS,
  ],
  {
    env: { ...process.env, NODE_ENV: "test" },
    // Inherited, not piped: Bun's own reporter is better than anything this
    // script could scrape out of it, and a long suite should print as it goes
    // rather than in one dump at the end.
    stdout: "inherit",
    stderr: "inherit",
  },
);

let timedOut = false;
const timer = setTimeout(() => {
  timedOut = true;
  tests.kill();
}, TIMEOUT_MS);

const exitCode = await tests.exited;
clearTimeout(timer);

if (timedOut) {
  console.error(
    `\nTest run exceeded ${Math.round(TIMEOUT_MS / 1000)}s and was killed. ` +
      "Set TEST_TIMEOUT_MS to raise the cap.",
  );
  process.exit(1);
}

type Timings = { files?: Record<string, number> };

const reportSlowest = async (): Promise<void> => {
  const file = Bun.file(TIMINGS_FILE);
  if (!(await file.exists())) return;

  let timings: Timings;
  try {
    timings = (await file.json()) as Timings;
  } catch {
    return;
  }

  const entries = Object.entries(timings.files ?? {}).slice(
    0,
    SLOWEST_TO_REPORT,
  );
  if (entries.length === 0) return;

  console.log("\nSlowest files:");
  for (const [path, ms] of entries) {
    console.log(`  ${String(ms).padStart(6)}ms  ${path}`);
  }
};

await reportSlowest();

process.exit(exitCode);
