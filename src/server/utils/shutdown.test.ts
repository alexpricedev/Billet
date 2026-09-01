import { afterAll, describe, expect, test } from "bun:test";
import { registerShutdown } from "./shutdown";

// Each registerShutdown call adds real process listeners. Snapshot what was
// there before the file ran and strip everything else afterwards, so a later
// file in the same worker can't trip an accidental drain.
const before = {
  SIGTERM: process.listeners("SIGTERM"),
  SIGINT: process.listeners("SIGINT"),
};

afterAll(() => {
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    for (const listener of process.listeners(signal)) {
      if (!before[signal].includes(listener)) {
        process.removeListener(signal, listener);
      }
    }
  }
});

/** A drain whose every step records itself, so order is assertable. */
const trackedDeps = () => {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      stopSweep: () => {
        calls.push("stopSweep");
      },
      server: {
        stop: async () => {
          calls.push("server.stop");
        },
      },
      db: {
        close: async () => {
          calls.push("db.close");
        },
      },
      exit: (code: number) => {
        calls.push(`exit(${code})`);
      },
    },
  };
};

describe("registerShutdown", () => {
  test("drains in order: sweep, server, pool, exit(0)", async () => {
    const { calls, deps } = trackedDeps();
    const shutdown = registerShutdown(deps);

    await shutdown("SIGTERM");

    expect(calls).toEqual(["stopSweep", "server.stop", "db.close", "exit(0)"]);
  });

  test("registers handlers for SIGTERM and SIGINT", () => {
    const termBefore = process.listenerCount("SIGTERM");
    const intBefore = process.listenerCount("SIGINT");

    registerShutdown(trackedDeps().deps);

    expect(process.listenerCount("SIGTERM")).toBe(termBefore + 1);
    expect(process.listenerCount("SIGINT")).toBe(intBefore + 1);
  });

  test("a second signal during the drain does not re-enter", async () => {
    const { calls, deps } = trackedDeps();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Hold the server drain open so the second signal arrives mid-shutdown.
    deps.server.stop = async () => {
      calls.push("server.stop");
      await gate;
    };
    const shutdown = registerShutdown(deps);

    const first = shutdown("SIGTERM");
    const second = shutdown("SIGINT");
    release();
    await Promise.all([first, second]);

    expect(calls).toEqual(["stopSweep", "server.stop", "db.close", "exit(0)"]);
  });

  // A rejection escaping the signal handler is an unhandled rejection, which
  // Bun treats as fatal — so an unguarded step would kill the process partway
  // through the drain, with the pool still open, which is the outcome
  // registerShutdown exists to prevent.
  test("a failing drain still closes the pool and exits", async () => {
    const { calls, deps } = trackedDeps();
    deps.server.stop = async () => {
      calls.push("server.stop");
      throw new Error("connection would not close");
    };
    const shutdown = registerShutdown(deps);

    await shutdown("SIGTERM");

    expect(calls).toEqual(["stopSweep", "server.stop", "db.close", "exit(0)"]);
  });

  test("a failing pool close still exits", async () => {
    const { calls, deps } = trackedDeps();
    deps.db.close = async () => {
      calls.push("db.close");
      throw new Error("pool already gone");
    };
    const shutdown = registerShutdown(deps);

    await shutdown("SIGTERM");

    expect(calls).toEqual(["stopSweep", "server.stop", "db.close", "exit(0)"]);
  });
});
