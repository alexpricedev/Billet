import { describe, expect, test } from "bun:test";
import {
  batch,
  computed,
  effect,
  isReadable,
  isSignal,
  runScope,
  signal,
} from "./signal";

describe("signal", () => {
  test("reads the initial value and the last set value", () => {
    const count = signal(1);
    expect(count.value).toBe(1);
    count.set(2);
    expect(count.value).toBe(2);
  });

  test("effect runs immediately, then synchronously on each change", () => {
    const count = signal(0);
    const seen: number[] = [];
    effect(() => {
      seen.push(count.value);
    });

    expect(seen).toEqual([0]);
    count.set(1);
    expect(seen).toEqual([0, 1]);
  });

  test("setting the same value is a no-op", () => {
    const count = signal(0);
    let runs = 0;
    effect(() => {
      count.value;
      runs++;
    });

    count.set(0);
    expect(runs).toBe(1);
  });

  test("effect stops after dispose", () => {
    const count = signal(0);
    let runs = 0;
    const dispose = effect(() => {
      count.value;
      runs++;
    });

    dispose();
    count.set(1);
    expect(runs).toBe(1);
  });

  test("cleanup runs before the next run and on dispose", () => {
    const count = signal(0);
    const log: string[] = [];
    const dispose = effect(() => {
      const value = count.value;
      log.push(`run ${value}`);
      return () => log.push(`cleanup ${value}`);
    });

    count.set(1);
    dispose();
    expect(log).toEqual(["run 0", "cleanup 0", "run 1", "cleanup 1"]);
  });

  test("a branch that stops reading a signal stops depending on it", () => {
    const useA = signal(true);
    const a = signal("a");
    const b = signal("b");
    let runs = 0;
    effect(() => {
      runs++;
      if (useA.value) a.value;
      else b.value;
    });

    useA.set(false);
    expect(runs).toBe(2);
    a.set("changed");
    expect(runs).toBe(2);
    b.set("changed");
    expect(runs).toBe(3);
  });

  test("an effect that writes what it reads fails instead of hanging", () => {
    const count = signal(0);
    expect(() =>
      effect(() => {
        count.set(count.value + 1);
      }),
    ).toThrow(/did not settle/);
  });
});

describe("computed", () => {
  test("derives lazily and caches until a dependency changes", () => {
    const count = signal(2);
    let computes = 0;
    const doubled = computed(() => {
      computes++;
      return count.value * 2;
    });

    expect(computes).toBe(0);
    expect(doubled.value).toBe(4);
    expect(doubled.value).toBe(4);
    expect(computes).toBe(1);

    count.set(3);
    expect(computes).toBe(1);
    expect(doubled.value).toBe(6);
    expect(computes).toBe(2);
  });

  test("an effect reading a signal and a computed of it runs once per write", () => {
    const count = signal(1);
    const doubled = computed(() => count.value * 2);
    const seen: string[] = [];
    effect(() => {
      seen.push(`${count.value}:${doubled.value}`);
    });

    count.set(2);
    // Never "2:2" — the computed is recomputed before the effect reads it.
    expect(seen).toEqual(["1:2", "2:4"]);
  });

  test("chains through computeds", () => {
    const count = signal(1);
    const doubled = computed(() => count.value * 2);
    const label = computed(() => `n=${doubled.value}`);
    let latest = "";
    effect(() => {
      latest = label.value;
    });

    count.set(5);
    expect(latest).toBe("n=10");
  });
});

describe("batch", () => {
  test("coalesces several writes into one effect run", () => {
    const first = signal("a");
    const last = signal("b");
    const seen: string[] = [];
    effect(() => {
      seen.push(`${first.value} ${last.value}`);
    });

    batch(() => {
      first.set("x");
      last.set("y");
      expect(seen).toEqual(["a b"]);
    });
    expect(seen).toEqual(["a b", "x y"]);
  });

  test("flushes even when the batch throws", () => {
    const count = signal(0);
    let latest = 0;
    effect(() => {
      latest = count.value;
    });

    expect(() =>
      batch(() => {
        count.set(1);
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(latest).toBe(1);
  });
});

describe("runScope", () => {
  test("disposes every effect created inside it", () => {
    const count = signal(0);
    let runs = 0;
    const dispose = runScope(() => {
      effect(() => {
        count.value;
        runs++;
      });
      effect(() => {
        count.value;
        runs++;
      });
    });

    count.set(1);
    expect(runs).toBe(4);
    dispose();
    count.set(2);
    expect(runs).toBe(4);
  });

  test("leaves effects created outside it alone", () => {
    const count = signal(0);
    let runs = 0;
    effect(() => {
      count.value;
      runs++;
    });
    const dispose = runScope(() => {});

    dispose();
    count.set(1);
    expect(runs).toBe(2);
  });
});

describe("type guards", () => {
  test("distinguish signals, computeds, and everything else", () => {
    const sig = signal(0);
    const comp = computed(() => 1);
    expect(isReadable(sig)).toBe(true);
    expect(isReadable(comp)).toBe(true);
    expect(isSignal(sig)).toBe(true);
    expect(isSignal(comp)).toBe(false);
    expect(isReadable({ value: 1 })).toBe(false);
    expect(isReadable(() => {})).toBe(false);
  });
});
