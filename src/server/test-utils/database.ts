/**
 * The database connection a test file talks to.
 *
 * Service and controller tests each `mock.module` the database module with
 * their own `SQL` instance, so every test file in the suite owns a pool. That
 * multiplies:
 *
 *     files running at once   = one per worker = os.cpus().length (10 here)
 *     connections per pool    = Bun's default max, which is 10
 *     peak connections        = 100, against a server whose max_connections
 *                               is typically 100 — and a dev server on the
 *                               same Postgres is already holding 10
 *
 * Past the line Postgres answers `sorry, too many clients already` (SQLSTATE
 * 53300) to whichever file happened to be connecting, not the one at fault, so
 * the failure names an innocent file and the run is green the next time. Capping
 * the pool here is what fixes it; capping the worker count only hides it, and
 * leaves the next test file free to add another ten.
 *
 * **Three, not one.** A test that reserves a connection — a session-level
 * advisory lock, a row lock, a `begin()` that also reads outside the
 * transaction — needs two at once. A pool of one deadlocks instead, and that
 * deadlock looks like a hang with no error attached.
 */

import { SQL } from "bun";

export const testDatabase = (): SQL => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for tests");
  }
  return new SQL(process.env.DATABASE_URL, { max: 3, idleTimeout: 5 });
};
