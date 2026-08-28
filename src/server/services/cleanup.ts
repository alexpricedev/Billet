import { cleanupExpired } from "./auth";
import { cleanupExpiredInvites } from "./invites";
import { log } from "./logger";
import { teamsEnabled } from "./teams-mode";

const MINUTE_MS = 60 * 1000;

// Hourly. Nothing reads an expired row — every query filters on `expires_at` —
// so the sweep is never on a correctness path and the interval only trades disk
// and retention window against write load. An hour keeps a spent magic-link
// hash around for at most that long past its expiry, which is well inside what
// runbooks/PRIVACY.md asks for, without a DELETE storm on a busy table.
const SWEEP_INTERVAL_MS = 60 * MINUTE_MS;

/**
 * Delete every expired row the app owns.
 *
 * Composes the per-service sweeps rather than owning their SQL, so each table's
 * predicate stays next to the queries that read it.
 *
 * The `teamsEnabled` guard is not about safety — with the flag off migration
 * `008`'s tables exist and are empty, so the DELETE is a no-op — it is about not
 * making a fork that never turned teams on pay for a statement against a table
 * it will never write. A fork that removed the feature outright deletes
 * `invites.ts`, and this import is then one of the unresolved references
 * `bun run check` reports; runbooks/TEAMS.md §9 lists it.
 */
export const runCleanupSweep = async (): Promise<void> => {
  await cleanupExpired();

  if (teamsEnabled()) {
    await cleanupExpiredInvites();
  }
};

// A rejection escaping a setInterval callback is an unhandled rejection, which
// Bun treats as fatal — a transient database blip during a sweep would take the
// server down. Swallow it and try again next hour; there is nothing to recover,
// the rows are inert either way.
const sweep = async (): Promise<void> => {
  try {
    await runCleanupSweep();
  } catch (error) {
    log.error(
      "cleanup",
      `Sweep failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

/**
 * Start the periodic sweep, returning a stop handle.
 *
 * Runs once immediately: a deploy that restarts more often than the interval
 * would otherwise never sweep at all.
 *
 * Deliberately not awaited by the caller — boot must not wait on a DELETE, and
 * a failing sweep must not stop the server serving.
 *
 * Every instance of a multi-instance deployment runs this. That is fine and
 * needs no lock: the statements are unconditional DELETEs over rows nothing can
 * still use, so the losers of the race simply delete nothing.
 */
export const startCleanupSweep = (): (() => void) => {
  void sweep();

  // The `unref` guard is copied from captcha.ts: the happy-dom test preload can
  // swap in a browser-style setInterval that returns a plain number with no
  // unref, and without it the timer keeps the test runner alive.
  const timer = setInterval(sweep, SWEEP_INTERVAL_MS);
  (timer as { unref?: () => void }).unref?.();

  return () => clearInterval(timer);
};
