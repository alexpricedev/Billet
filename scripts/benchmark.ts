#!/usr/bin/env bun

/**
 * Toolchain benchmarks, for before/after comparison across a change.
 *
 * The suite, the checks and the build are the feedback loop this repo argues
 * for, so a change to any of them is a change to the product. This records what
 * they cost right now, so a claim like "the new runner is three times faster"
 * has a number behind it rather than an impression.
 *
 *   bun run bench                    run everything, print the table
 *   bun run bench save before        run everything, save it as "before"
 *   bun run bench compare before after
 *   bun run bench list
 *
 * Flags: `--runs=N` (default 3, the median is reported), `--only=test,check`,
 * `--note="what changed"`.
 *
 * The spread column is the resolution: `test` varies by ~13% across three runs
 * on a 4-core cloud container, so a change smaller than that is not a result.
 * `compare` says "within noise" instead of a percentage when the difference is
 * inside the observed variation of either record.
 *
 * **Record the pair back to back.** The same machine is not the same machine an
 * hour later — a shared container drifted 45% between two runs of an identical
 * commit during this script's own development, which is more than enough to
 * invent a regression. `compare` warns when two records are more than half an
 * hour apart, but the only real defence is measuring A and B together.
 *
 * Two things make the numbers trustworthy rather than decorative:
 *
 * 1. **A failed command is never a fast one.** A red suite finishes early, so a
 *    non-zero exit aborts the run instead of recording a flattering time.
 * 2. **Counts are recorded next to durations.** A runner change that silently
 *    stops discovering test files looks exactly like a large speedup;
 *    `compare` treats a change in the pass/file count as a failure to explain,
 *    not a win.
 *
 * Results live in `.benchmarks/` (gitignored). They describe one machine at one
 * moment: comparing a laptop against a CI runner measures the hardware.
 * `compare` prints the environment of both records and flags a hardware
 * mismatch — but it deliberately allows a differing Bun version, since that is
 * the comparison this exists for.
 */

import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { cpus, totalmem } from "node:os";

const RESULTS_DIR = ".benchmarks";

// ---------------------------------------------------------------------------
// What gets measured
// ---------------------------------------------------------------------------

type Benchmark = {
  name: string;
  /** The command a contributor would actually type. */
  command: string[];
  /** Reads counts out of the output, when the command reports any. */
  counts?: (output: string) => Record<string, number>;
};

// Tolerant on purpose: `run-tests.ts` prints "755 pass, 0 fail across 68
// files", a bare `bun test` prints "755 pass" / "0 fail" and "Ran 755 tests
// across 68 files". Both parse here, so the benchmark survives the runner
// change it exists to measure. Last match wins — per-file lines come first.
const lastNumber = (output: string, pattern: RegExp): number | undefined => {
  const matches = [...output.matchAll(pattern)];
  const last = matches.at(-1);
  return last ? Number.parseInt(last[1], 10) : undefined;
};

const testCounts = (output: string): Record<string, number> => {
  const counts: Record<string, number> = {};
  const pass = lastNumber(output, /(\d+) pass/g);
  const fail = lastNumber(output, /(\d+) fail/g);
  const files = lastNumber(output, /across (\d+) files/g);
  if (pass !== undefined) counts.pass = pass;
  if (fail !== undefined) counts.fail = fail;
  if (files !== undefined) counts.files = files;
  return counts;
};

const BENCHMARKS: Benchmark[] = [
  { name: "test", command: ["bun", "run", "test"], counts: testCounts },
  { name: "check", command: ["bun", "run", "check"] },
  { name: "build", command: ["bun", "run", "build"] },
];

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

type Result = {
  name: string;
  command: string;
  runs: number[];
  median: number;
  min: number;
  max: number;
  counts?: Record<string, number>;
};

type Environment = {
  bun: string;
  platform: string;
  arch: string;
  cpuCount: number;
  cpuModel: string;
  memoryGb: number;
  commit: string;
  branch: string;
  dirty: boolean;
};

type Record_ = {
  label: string;
  recordedAt: string;
  note?: string;
  environment: Environment;
  results: Result[];
};

const git = async (...args: string[]): Promise<string> => {
  const proc = Bun.spawn(["git", ...args], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out.trim();
};

const environment = async (): Promise<Environment> => ({
  bun: Bun.version,
  platform: process.platform,
  arch: process.arch,
  cpuCount: cpus().length,
  cpuModel: cpus()[0]?.model ?? "unknown",
  memoryGb: Math.round(totalmem() / 1024 ** 3),
  commit: (await git("rev-parse", "--short", "HEAD")) || "unknown",
  branch: (await git("rev-parse", "--abbrev-ref", "HEAD")) || "unknown",
  dirty: (await git("status", "--porcelain")).length > 0,
});

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
};

const runOnce = async (
  benchmark: Benchmark,
): Promise<{ ms: number; output: string }> => {
  const started = performance.now();
  const proc = Bun.spawn(benchmark.command, {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const ms = Math.round(performance.now() - started);

  // A benchmark of a broken command measures how fast it gives up. Fail here
  // rather than write a number nobody can interpret later.
  if (exitCode !== 0) {
    console.error(
      `\nbench: \`${benchmark.command.join(" ")}\` exited ${exitCode} — nothing recorded.`,
    );
    console.error(stdout + stderr);
    process.exit(1);
  }

  return { ms, output: stdout + stderr };
};

const measure = async (benchmark: Benchmark, runs: number): Promise<Result> => {
  const durations: number[] = [];
  let lastOutput = "";

  process.stdout.write(`  ${benchmark.name.padEnd(6)}`);
  for (let i = 0; i < runs; i++) {
    const { ms, output } = await runOnce(benchmark);
    durations.push(ms);
    lastOutput = output;
    process.stdout.write(` ${(ms / 1000).toFixed(1)}s`);
  }
  process.stdout.write("\n");

  const counts = benchmark.counts?.(lastOutput);

  return {
    name: benchmark.name,
    command: benchmark.command.join(" "),
    runs: durations,
    median: median(durations),
    min: Math.min(...durations),
    max: Math.max(...durations),
    ...(counts && Object.keys(counts).length > 0 ? { counts } : {}),
  };
};

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const secs = (ms: number): string => `${(ms / 1000).toFixed(2)}s`;

const printEnvironment = (env: Environment, prefix = ""): void => {
  console.log(
    `${prefix}Bun ${env.bun} · ${env.platform}/${env.arch} · ${env.cpuCount} cores · ${env.memoryGb}GB · ${env.commit}${env.dirty ? " (dirty)" : ""} on ${env.branch}`,
  );
};

/**
 * Run-to-run variation as a percentage of the median.
 *
 * This is the resolution of the whole exercise: a change smaller than the
 * spread is not a result, it is the same number twice. On a shared CI runner or
 * a laptop with a browser open, `test` routinely varies by more than 10%.
 */
const spread = (r: Result): number =>
  r.runs.length < 2 ? 0 : ((r.max - r.min) / r.median) * 100;

const NOISY_SPREAD_PCT = 10;

// Below a second, a couple of milliseconds of process-start jitter is already a
// double-digit percentage, so the spread stops describing the command and starts
// describing the clock. `build` runs in ~30ms and would otherwise be flagged
// every time.
const NOISY_MIN_MEDIAN_MS = 1000;

// Two records further apart than this get a drift warning from `compare`.
const STALE_PAIR_MINUTES = 30;

const printResults = (record: Record_): void => {
  console.log("");
  printEnvironment(record.environment);
  console.log("");
  console.log("  bench    median      min      max   spread   counts");
  console.log("  --------------------------------------------------");
  for (const r of record.results) {
    const counts = r.counts
      ? Object.entries(r.counts)
          .map(([k, v]) => `${v} ${k}`)
          .join(", ")
      : "";
    console.log(
      `  ${r.name.padEnd(7)} ${secs(r.median).padStart(7)} ${secs(r.min).padStart(8)} ${secs(r.max).padStart(8)} ${`${spread(r).toFixed(0)}%`.padStart(7)}   ${counts}`,
    );
  }
  console.log("");

  const noisy = record.results.filter(
    (r) => r.median >= NOISY_MIN_MEDIAN_MS && spread(r) > NOISY_SPREAD_PCT,
  );
  for (const r of noisy) {
    console.log(
      `  note: ${r.name} varied by ${spread(r).toFixed(0)}% across ${r.runs.length} runs — a later change smaller than that is not a result`,
    );
  }
  if (noisy.length > 0) console.log("");
};

// ---------------------------------------------------------------------------
// Saved records
// ---------------------------------------------------------------------------

const recordPath = (label: string): string => `${RESULTS_DIR}/${label}.json`;

const save = async (record: Record_): Promise<void> => {
  mkdirSync(RESULTS_DIR, { recursive: true });
  await Bun.write(
    recordPath(record.label),
    `${JSON.stringify(record, null, 2)}\n`,
  );
  console.log(`  saved → ${recordPath(record.label)}\n`);
};

const load = async (label: string): Promise<Record_> => {
  const path = recordPath(label);
  if (!existsSync(path)) {
    throw new Error(
      `no saved record "${label}" — \`bun run bench list\` shows what there is`,
    );
  }
  return (await Bun.file(path).json()) as Record_;
};

const list = (): void => {
  if (!existsSync(RESULTS_DIR)) {
    console.log("bench: no saved records yet");
    return;
  }
  const labels = readdirSync(RESULTS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
  if (labels.length === 0) {
    console.log("bench: no saved records yet");
    return;
  }
  console.log("");
  for (const label of labels) {
    console.log(`  ${label}`);
  }
  console.log("");
};

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

const compare = async (beforeLabel: string, afterLabel: string) => {
  const before = await load(beforeLabel);
  const after = await load(afterLabel);

  console.log("");
  printEnvironment(before.environment, `  ${beforeLabel}: `);
  printEnvironment(after.environment, `  ${afterLabel}: `);
  if (before.note) console.log(`  ${beforeLabel} note: ${before.note}`);
  if (after.note) console.log(`  ${afterLabel} note: ${after.note}`);

  // The failure mode this catches is the one that actually happens: two records
  // taken hours apart on the same machine, compared as if only the code changed.
  // A shared cloud container drifted 45% between two runs of an identical
  // commit while this script was being written — enough to invent a large
  // regression out of nothing. Same hardware is not the same machine over time.
  const apartMs = Math.abs(
    Date.parse(after.recordedAt) - Date.parse(before.recordedAt),
  );
  const apartMinutes = Math.round(apartMs / 60_000);
  if (apartMinutes > STALE_PAIR_MINUTES) {
    console.log(
      `\n  ⚠ recorded ${apartMinutes} minutes apart — re-record both back to back before\n` +
        "    trusting any difference below; machine drift over that gap can exceed it",
    );
  }

  // A differing Bun version is the point of this tool. Differing hardware is
  // not a comparison at all, so say so rather than printing a percentage.
  const hardware: (keyof Environment)[] = [
    "platform",
    "arch",
    "cpuCount",
    "cpuModel",
  ];
  const mismatched = hardware.filter(
    (key) => before.environment[key] !== after.environment[key],
  );
  if (mismatched.length > 0) {
    console.log(
      `\n  ⚠ different hardware (${mismatched.join(", ")}) — these numbers are not comparable`,
    );
  }

  // The durations are right-aligned in a fixed column, so the two label
  // headings have to be sized to match rather than padded to a guess — a label
  // longer than the guess pushes every heading out of step with its numbers.
  const width = Math.max(9, beforeLabel.length, afterLabel.length);
  console.log("");
  console.log(
    `  bench   ${beforeLabel.padStart(width)} ${afterLabel.padStart(width)}   change`,
  );
  console.log(`  ${"-".repeat(20 + width * 2)}`);

  const warnings: string[] = [];

  for (const b of before.results) {
    const a = after.results.find((r) => r.name === b.name);
    if (!a) {
      warnings.push(`"${b.name}" is missing from ${afterLabel}`);
      continue;
    }

    const delta = a.median - b.median;
    const pct = (delta / b.median) * 100;
    const arrow = delta <= 0 ? "faster" : "slower";

    // Report the change against the noise that produced it. A 6% gain measured
    // on runs that varied by 13% is a coin flip, and saying so here is cheaper
    // than someone building a release note on it.
    const noise =
      b.median >= NOISY_MIN_MEDIAN_MS ? Math.max(spread(b), spread(a)) : 0;
    const verdict =
      Math.abs(pct) <= noise
        ? `within noise (±${noise.toFixed(0)}%)`
        : `${Math.abs(pct).toFixed(0)}% ${arrow}`;

    console.log(
      `  ${b.name.padEnd(7)} ${secs(b.median).padStart(width)} ${secs(a.median).padStart(width)}   ${verdict}`,
    );

    // The guard that matters: a change in what was counted invalidates the
    // timing next to it.
    for (const [key, value] of Object.entries(b.counts ?? {})) {
      const then = a.counts?.[key];
      if (then !== value) {
        warnings.push(
          `${b.name}: ${key} went ${value} → ${then ?? "absent"} — the timings above are not measuring the same work`,
        );
      }
    }
  }

  console.log("");
  for (const warning of warnings) {
    console.log(`  ⚠ ${warning}`);
  }
  if (warnings.length > 0) {
    console.log("");
    process.exit(1);
  }
};

// ---------------------------------------------------------------------------

const flag = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const run = async (label: string, shouldSave: boolean) => {
  const runs = Number.parseInt(flag("runs") ?? "3", 10);
  if (!Number.isSafeInteger(runs) || runs < 1) {
    throw new Error(`--runs must be a positive integer, got "${flag("runs")}"`);
  }

  const only = flag("only")
    ?.split(",")
    .map((s) => s.trim());
  const selected = only
    ? BENCHMARKS.filter((b) => only.includes(b.name))
    : BENCHMARKS;
  if (selected.length === 0) {
    throw new Error(
      `--only matched nothing; available: ${BENCHMARKS.map((b) => b.name).join(", ")}`,
    );
  }

  const env = await environment();
  if (env.dirty) {
    console.log(
      "bench: working tree is dirty — the record will say so, but a benchmark of\n" +
        "       uncommitted work is hard to reproduce later.",
    );
  }
  console.log(`\nbench: ${runs} run(s) each, median reported`);

  const results: Result[] = [];
  for (const benchmark of selected) {
    results.push(await measure(benchmark, runs));
  }

  const record: Record_ = {
    label,
    recordedAt: new Date().toISOString(),
    ...(flag("note") ? { note: flag("note") } : {}),
    environment: env,
    results,
  };

  printResults(record);
  if (shouldSave) await save(record);
};

const command = process.argv[2];

try {
  if (command === "save") {
    const label = process.argv[3];
    if (!label) throw new Error("usage: bun run bench save <label>");
    await run(label, true);
  } else if (command === "compare") {
    const [, , , a, b] = process.argv;
    if (!a || !b)
      throw new Error("usage: bun run bench compare <before> <after>");
    await compare(a, b);
  } else if (command === "list") {
    list();
  } else if (command === undefined || command.startsWith("--")) {
    await run("adhoc", false);
  } else {
    console.error(
      "Usage: bun run bench [save <label> | compare <before> <after> | list]\n" +
        '       [--runs=N] [--only=test,check,build] [--note="..."]',
    );
    process.exit(1);
  }
} catch (error) {
  console.error(
    `bench: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
