/**
 * Per-worker test databases, for `bun test --parallel`.
 *
 * Every test file truncates every table (`cleanupTestData` in `helpers.ts`), so
 * one database shared across parallel workers means each worker wipes the
 * others' rows mid-run. It is the same failure two agents sharing one
 * `billet-test` hit — the one `scripts/workspace.ts` exists to prevent — one
 * level further down, and it fails in the same unreproducible way.
 *
 * So each worker gets its own database, named by appending its 1-indexed slot
 * to the base name. Bun exposes the slot as `BUN_TEST_WORKER_ID` (and
 * `JEST_WORKER_ID`, for Jest setups that key databases or ports off it).
 *
 * **Worker 1 keeps the base name.** A run with no parallelism, a single
 * `bun run test:file`, and worker 1 of a parallel run therefore all use exactly
 * the database they always did — only slots 2 and up need a database of their
 * own, and only a parallel run creates any.
 *
 * The derivation lives here rather than in the runner because `test-env.ts`
 * needs it too, and a preload is the only thing that runs before
 * `services/database.ts` builds its pool from `DATABASE_URL`.
 *
 * `scripts/workspace.ts` has its own copies of the two URL helpers below. That
 * is deliberate: it runs at workspace-setup time, before anything under `src/`
 * is known to work, and is meant to stay standalone.
 */

/** Swap the database name in a connection string, keeping credentials and host. */
export const withDatabase = (
  connectionString: string,
  database: string,
): string => {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url.toString();
};

export const databaseName = (connectionString: string): string =>
  new URL(connectionString).pathname.replace(/^\//, "");

/**
 * The database name a given worker slot should use.
 *
 * Slot 1, an unset slot, and anything unparseable all map to the base name, so
 * a non-parallel run is never given a database that doesn't exist.
 */
export const workerDatabaseName = (
  baseUrl: string,
  workerId: string | undefined,
): string => {
  const base = databaseName(baseUrl);
  if (base === "") {
    throw new Error(
      `DATABASE_URL has no database name to derive a worker database from: ${baseUrl}`,
    );
  }

  const slot = Number.parseInt(workerId ?? "", 10);
  return Number.isSafeInteger(slot) && slot > 1 ? `${base}-w${slot}` : base;
};

/** The same, as a full connection string. */
export const workerDatabaseUrl = (
  baseUrl: string,
  workerId: string | undefined,
): string => withDatabase(baseUrl, workerDatabaseName(baseUrl, workerId));

/**
 * The worker slots that need a database created for them, for a run of N
 * workers. Empty for a single worker, since slot 1 uses the base database.
 */
export const workerSlots = (workers: number): number[] =>
  workers <= 1 ? [] : Array.from({ length: workers - 1 }, (_, i) => i + 2);

/** Double-quoted identifier, for a `CREATE DATABASE` a hyphen would otherwise break. */
export const quoteIdent = (name: string): string =>
  `"${name.replace(/"/g, '""')}"`;
