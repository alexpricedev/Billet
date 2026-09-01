---
name: profiling
description: How to profile CPU, heap, and bundle size in this repo with Bun's markdown-format profilers. Use when a route or script is slow, memory grows without an obvious owner, the client bundle got bigger, or a performance claim needs a measurement before a rewrite.
---

# Profiling

Bun 1.4 can emit profiles as Markdown instead of the binary formats that need
Chrome DevTools — which means you can read them directly. Always measure before
rewriting for performance; this repo has already banked one decision that way
(sync compression stays: 18–95µs per response at realistic page sizes, three
orders of magnitude below a database query).

## CPU: where the time goes

```bash
bun --cpu-prof-md ./script-under-test.ts
```

Writes `<name>.cpuprofile.md` in the working directory on exit: a table of
functions by self-time and total-time, with file:line. To profile the server,
run it under the flag, drive load at it (`curl` in a loop, or the benchmark
harness), then SIGTERM it — the profile is written on exit, and the graceful
shutdown handler exits cleanly.

Sampling default is 1000µs; `--cpu-prof-interval=100` for short-lived scripts
that would otherwise land too few samples to mean anything.

## Heap: what's holding memory

```bash
bun --heap-prof-md ./script-under-test.ts
```

Writes a Markdown heap profile on exit — allocation sites by retained size.
Same drive-then-exit pattern for the server. Default sampling is one in 512KB
of allocations; lower `--heap-prof-interval` for finer attribution at the cost
of overhead.

## Bundle: what's in the client JS

```bash
bun build ./src/client/main.ts ./src/client/captcha.ts \
  --outdir /tmp/bundle-analysis --minify \
  --external preact --external preact/hooks \
  --external preact/jsx-dev-runtime --external preact/jsx-runtime \
  --metafile-md=/tmp/bundle-analysis/meta.md
```

The module graph and per-module byte counts, as Markdown. Mirror the exact
flags from `build:client` in `package.json` (externals change the numbers) and
build to a scratch dir — never to `dist/assets`, which the dev server serves.

## Ground rules

- Profiles and benchmark numbers are only comparable when recorded back to back
  on the same host — see the benchmark section of `RELEASE_3.0.md` (and later,
  `scripts/benchmark.ts`) for how that once produced a phantom 34% regression.
- Microsecond-scale wins next to a millisecond database query are not wins.
  State the denominator when reporting a finding.
- Don't commit profile output; it belongs in the PR description or a scratch
  file, not the tree.
