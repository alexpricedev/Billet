// The reactivity primitive: a signal holds a value, a computed derives one, and
// an effect runs side effects when what it read has changed. Dependencies are
// tracked by reading — there is no dependency list to keep in step with the
// function body, so a stale one can't exist.
//
// Deliberately synchronous. `set` runs every affected effect before it returns,
// so a test sets a value and asserts on the DOM on the next line with nothing
// to await. Computeds are pull-based: a write marks them stale and they
// recompute on the next read, so an effect that depends on both a signal and a
// computed of it runs once per write, never twice with the computed still stale
// in between. `batch` coalesces several writes into one run.

export interface Readable<T> {
  readonly value: T;
}

// Reads go through `.value` on both; only a signal has `set`. A method rather
// than a setter because TypeScript ignores `readonly` when checking
// assignability, so a computed would otherwise pass wherever a signal is
// required — the check `bindings<T>()` makes for `data-value`.
export interface Signal<T> extends Readable<T> {
  set(next: T): void;
}

export type EffectCleanup = () => void;

interface Source {
  readonly observers: Set<Observer>;
}

interface Observer {
  readonly sources: Set<Source>;
  notify(): void;
}

let tracking: Observer | null = null;
let batchDepth = 0;
let flushing = false;
const pending: EffectNode[] = [];

// Effects register their disposer with the innermost open scope, which is how
// `mount` tears down everything a component created without the component
// having to hand each effect back. See `runScope`.
let scope: Array<() => void> | null = null;

// A write that keeps re-triggering the effect that made it is a programming
// error; this turns the hang into an error naming the problem.
const MAX_FLUSH_ITERATIONS = 1000;

function track(source: Source): void {
  if (tracking) {
    source.observers.add(tracking);
    tracking.sources.add(source);
  }
}

function untrackSources(observer: Observer): void {
  for (const source of observer.sources) {
    source.observers.delete(observer);
  }
  observer.sources.clear();
}

// Run `fn` with `observer` as the tracking context, re-collecting its sources
// from scratch so a branch that stopped reading a signal stops depending on it.
function runTracked<T>(observer: Observer, fn: () => T): T {
  untrackSources(observer);
  const previous = tracking;
  tracking = observer;
  try {
    return fn();
  } finally {
    tracking = previous;
  }
}

// One flush at a time. A write made *during* an effect run queues the affected
// effects and returns; the loop already running picks them up, so a run never
// nests inside another and a cycle shows up as the iteration count, not as a
// stack overflow.
function flush(): void {
  if (flushing) return;
  flushing = true;
  let iterations = 0;
  try {
    while (pending.length > 0) {
      if (++iterations > MAX_FLUSH_ITERATIONS) {
        pending.length = 0;
        throw new Error(
          "Reactive effects did not settle — an effect is writing to a signal it reads.",
        );
      }
      const next = pending.shift() as EffectNode;
      next.queued = false;
      next.run();
    }
  } finally {
    flushing = false;
  }
}

class SignalNode<T> implements Signal<T>, Source {
  readonly observers = new Set<Observer>();

  constructor(private current: T) {}

  get value(): T {
    track(this);
    return this.current;
  }

  set(next: T): void {
    if (Object.is(next, this.current)) return;
    this.current = next;
    // Copy first: an observer's notify() can add or remove entries.
    for (const observer of Array.from(this.observers)) {
      observer.notify();
    }
    if (batchDepth === 0) flush();
  }
}

class ComputedNode<T> implements Readable<T>, Source, Observer {
  readonly observers = new Set<Observer>();
  readonly sources = new Set<Source>();
  private stale = true;
  private current!: T;

  constructor(private readonly compute: () => T) {}

  get value(): T {
    track(this);
    if (this.stale) {
      this.current = runTracked(this, this.compute);
      this.stale = false;
    }
    return this.current;
  }

  notify(): void {
    if (this.stale) return;
    this.stale = true;
    for (const observer of Array.from(this.observers)) {
      observer.notify();
    }
  }
}

class EffectNode implements Observer {
  readonly sources = new Set<Source>();
  queued = false;
  private disposed = false;
  private cleanup: EffectCleanup | undefined;

  constructor(private readonly fn: () => unknown) {}

  run(): void {
    if (this.disposed) return;
    this.cleanup?.();
    this.cleanup = undefined;
    const result = runTracked(this, this.fn);
    if (typeof result === "function") this.cleanup = result as EffectCleanup;
  }

  notify(): void {
    if (this.queued || this.disposed) return;
    this.queued = true;
    pending.push(this);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cleanup?.();
    this.cleanup = undefined;
    untrackSources(this);
  }
}

export function signal<T>(initial: T): Signal<T> {
  return new SignalNode(initial);
}

export function computed<T>(compute: () => T): Readable<T> {
  return new ComputedNode(compute);
}

/**
 * Run `fn` now and again whenever a signal it read changes. `fn` may return a
 * cleanup that runs before the next run and on dispose — the place to remove a
 * listener the effect added.
 */
export function effect(fn: () => void): () => void;
export function effect(fn: () => EffectCleanup): () => void;
export function effect(fn: () => unknown): () => void {
  const node = new EffectNode(fn);
  // Through the queue, not a direct run, so the first run obeys the same
  // one-flush-at-a-time rule as every later one.
  node.notify();
  if (batchDepth === 0) flush();
  const dispose = () => node.dispose();
  scope?.push(dispose);
  return dispose;
}

/** Defer effects until `fn` returns, so several writes cause one run each. */
export function batch(fn: () => void): void {
  batchDepth++;
  try {
    fn();
  } finally {
    batchDepth--;
    // In the finally so writes made before a throw still reach their effects.
    if (batchDepth === 0) flush();
  }
}

/**
 * Run `fn` and return one disposer for every effect it created synchronously.
 * Effects created later — inside an event handler, say — are not collected;
 * dispose those yourself.
 */
export function runScope(fn: () => void): () => void {
  const collected: Array<() => void> = [];
  const previous = scope;
  scope = collected;
  try {
    fn();
  } finally {
    scope = previous;
  }
  return () => {
    for (const dispose of collected) dispose();
    collected.length = 0;
  };
}

export function isReadable(value: unknown): value is Readable<unknown> {
  return value instanceof SignalNode || value instanceof ComputedNode;
}

export function isSignal(value: unknown): value is Signal<unknown> {
  return value instanceof SignalNode;
}
