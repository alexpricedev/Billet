import { log } from "../services/logger";

type ShutdownDeps = {
  /** Stop handle from `startCleanupSweep` — cancels the next scheduled sweep. */
  stopSweep: () => void;
  /** The `Bun.serve` instance; `stop()` resolves once the last connection closes. */
  server: { stop: () => Promise<void> };
  /** The connection pool from `services/database`. */
  db: { close: () => Promise<void> };
  /** Injectable for tests; production always exits the process. */
  exit?: (code: number) => void;
};

/**
 * Register SIGTERM/SIGINT handlers that drain the server before exiting.
 *
 * Without this, every deploy severs in-flight requests: the platform sends
 * SIGTERM and Bun's default disposition kills the process mid-response. On Bun
 * 1.4 `server.stop()` closes idle keep-alives immediately, lets busy
 * connections finish the response they're on, and resolves when the last one
 * closes — which is what makes draining worth doing at all.
 *
 * The order is load-bearing: the sweep stops first so no new database work
 * starts, the server drains while the pool is still open (in-flight requests
 * need it), and the pool closes last. A second signal during the drain is
 * ignored rather than re-entering the sequence — an operator who can't wait
 * has SIGKILL.
 *
 * Returns the drain function so a test can run it without sending the process
 * a real signal.
 */
export const registerShutdown = ({
  stopSweep,
  server,
  db,
  exit = process.exit,
}: ShutdownDeps): ((signal: string) => Promise<void>) => {
  let draining = false;

  /**
   * Run one step of the drain, and never let it take the rest down with it.
   *
   * A rejection escaping a signal handler is an unhandled rejection, which Bun
   * treats as fatal — the same hazard `services/cleanup.ts` guards its sweep
   * against. Here it would kill the process partway through the drain, with
   * the pool still open and `exit` never reached, which is precisely the
   * outcome this function exists to prevent. So each step is best-effort: it
   * says what failed and the sequence continues.
   */
  const step = async (name: string, run: () => unknown): Promise<void> => {
    try {
      await run();
    } catch (error) {
      log.error(
        "server",
        `${name} failed during shutdown: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const shutdown = async (signal: string): Promise<void> => {
    if (draining) return;
    draining = true;
    log.info("server", `${signal} received, draining`);

    await step("cleanup sweep", stopSweep);
    await step("server drain", () => server.stop());
    await step("pool close", () => db.close());

    // Zero even after a failed step: the process was asked to stop and it
    // stopped. A non-zero code here would read as a crashed deploy, and the
    // error above is the record of what went wrong.
    exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  return shutdown;
};
