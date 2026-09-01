# Billet 3.0 — working plan

Scratch coordination doc for the 3.0 release: what has landed, what is left, and the decisions
already made so they don't get re-argued. **Delete this file when 3.0 ships** — `CHANGELOG.md` is
the durable record.

Branch: `claude/project-guidelines-integration-mz85do`, pushed. Eight commits, `main` at #64.

Two threads run through it. One is an audit against
[elsewhencode/project-guidelines](https://github.com/elsewhencode/project-guidelines); the other is
adopting [Bun 1.4](https://bun.com/blog/bun-v1.4). The API response-shape change and the Bun 1.4
floor both make this a major.

---

## Resuming from a cold checkout

The suite needs PostgreSQL and `.env.test`, and the toolchain is pinned:

```bash
bun install                       # engines.bun >= 1.4.0, .bun-version is 1.4.0
echo 'DATABASE_URL=postgresql://…/billet-test' > .env.test   # the only key it carries
bun run check                     # biome + tsc
bun run test                      # migrations, then --isolate --parallel
```

`bun run test` creates `billet-test-w2`, `-w3`, … on first run — one per core beyond the first.
`TEST_WORKERS=1` runs serially in one process, which is what you want when a failure needs a
readable, ordered log instead of four interleaved ones.

Benchmarks: `bun run bench save <label>` / `bun run bench compare <a> <b>`. Records live in
`.benchmarks/` (gitignored), so **nothing carries across machines** — record a fresh pair back to
back on whatever host you're on. Numbers below are from a 4-core linux/x64 container and are only
meaningful against each other.

---

## Landed

| Commit | What |
|---|---|
| `47401b6` | JSON API: shared `{ error: { code, message } }` envelope, request guards, pagination |
| `133c8b8` | `.bun-version` + `engines.bun`, `bun audit` workflow, Dependabot, `.editorconfig` |
| `6dc213e` | `clearRateLimitLog()` in `team.test.ts` — the fix that made one-process runs possible |
| `857aabb` | `bun run bench` — the benchmark harness |
| `82abc83` | Require Bun 1.4.0 (Phase 0: pin moved, nothing under `src/` changed) |
| `f2a72f9` | `bun test --isolate`, one process |
| `286ce56` | `--parallel` with per-worker databases, plus the last-owner atomicity fix |
| `fd9a81d` | Correct the overstated severity of that write skew |
| `ac653e8` | `@types/bun` 1.4.0 + direct `@types/node` pin; route-literal generics dropped (see gotchas) |
| `6fa58ad` | HEAD answers with GET's headers on every dispatched route, advertised in `Allow` |
| `1ada9c2` | Graceful shutdown (`registerShutdown` in `utils/shutdown.ts`) + cleanup sweep on `Bun.cron` |

Suite: **55.15s → 14.49s** (process-per-file → 4 workers), 761 pass / 0 fail across 69 files.
Isolate alone was 55.15 → 45.96; parallelism took 44.15 → 14.49 on the same tree. (Those numbers
are from the 4-core linux container; the same suite runs ~4.4s on the M-series dev machine.)

Phase 2 is done, verified against a live server: HEAD 200s across `/`, `/projects`, `/login`,
`/api/projects` with an empty body; DELETE still 405s; SIGTERM logs `draining` and exits cleanly
with no pool-close warnings. Notes for whoever touches these next:

- The drain order in `utils/shutdown.ts` is load-bearing: sweep → `server.stop()` → pool. A second
  signal during the drain is ignored, not re-entered.
- `db.close()` fires `onclose` per pooled connection with a generic error; `closeDatabase` in
  `services/database.ts` exists to mark the drain deliberate so the unexpected-close warning stays
  meaningful. Shutdown goes through it, not `db.close()` directly.
- The sweep schedule is `"0 * * * *"` with `{ tz: "UTC" }` — the local-time trap is real, we hit
  the types for it. The happy-dom `unref` cast is gone with the `setInterval`.

---

## Phase 3 — tooling and docs — done

- **Dev script** is `bun run --parallel --no-orphans dev:client dev:server dev:css` — verified:
  name-prefixed output, server answers, killing the parent leaves no listener on the port.
- **Supply-chain commands** are in `runbooks/CI.md` §1b: `bun audit fix` first, `bun pm diff`
  before merging bumps nobody here authored, `bun pm licenses --prod` and `bun dedupe --check` as
  on-demand one-liners (deliberately not CI steps — see the runbook for why). `dedupe --check`
  found two duplicate versions on its first run; they're collapsed.
- **Markdown profiles** got the skill: `.claude/skills/profiling/SKILL.md` covers `--cpu-prof-md`,
  `--heap-prof-md` and `bun build --metafile-md`, with the drive-then-SIGTERM pattern for
  profiling the server (the graceful shutdown handler is what makes that exit clean).
- **CSRF order test** landed with the loud-log fix: clone-throwing-after-read now logs an error
  naming the ordering violation instead of degrading to a silent 403, and a test pins the reason.
- **Rate limiter** keys on the socket address (`middleware/client-ip.ts`), with `TRUST_PROXY=true`
  opting into the last `x-forwarded-for` entry behind a single trusted proxy. Boot-validated;
  `runbooks/SECURITY.md` §5 says to set it on Railway. The audit item is closed.
- **CI shards.** `--shard=i/N` with `--timings` is available if CI needs it. Probably not: workers
  default to core count, so GitHub's 4-vCPU runners already parallelise. Watch the first CI run.

---

## Decided — don't re-litigate

- **Static `{ dir }` routes: rejected.** A `dir` route is a declarative object, not a handler, so
  `secureRoutes` can't wrap it and those responses would bypass `handleGuarded` entirely — no
  security headers, no compression, against a stated invariant. Phase 0 also showed the free half is
  already banked: `Range: bytes=0-49` returns `206` with a correct `Content-Range` on 1.4 with no
  code change, and `serveFile`'s weak ETag still wins the conditional request. All `{ dir }` would
  add is sendfile streaming and the traversal hardening. Not worth the headers.
- **`serveDevBundle` stays exactly as it is.** The mid-rebuild empty-read 503 is the whole reason it
  exists; `{ dir }` would hand back a cached zero-byte 200.
- **`Bun.CSRF`: keep ours.** 1.4's `sessionId` option covers generate/verify but can't express the
  taxonomy in `middleware/csrf.ts` — `expired-token` is recoverable and re-renders the form with a
  fresh token and the user's input intact, `invalid-origin` never is.
- **HTTP/3: not yet.** Labelled experimental, `server.upgrade()` returns `false` over H3, release
  notes say don't ship it.
- **`Bun.markdown`: no.** Its HTML output is explicitly unsanitized — raw HTML, event handlers and
  `javascript:` hrefs pass through. Not worth opening that door in a starter.
- **`Bun.WebView`: adopted for smoke tests, opt-in only.** The earlier "parked" call was reversed
  after a spike: `bun run test:browser` (`scripts/browser-smoke.test.ts`) runs four journeys in
  system WebKit in ~1s — home renders styled, the client bundle hydrates, a guest submits the form
  through the CSRF round-trip with trusted clicks, and the page console stayed clean. Deliberately
  outside `bun run test` (experimental API, engine varies by platform) and it must stay that way.
  The spike immediately paid for itself — see `upgrade-insecure-requests` in the gotchas. This is
  smoke testing only; the automated-a11y decision is unchanged.
- **`Bun.Image`, `Bun.Terminal`, `Bun.Archive`, `Bun.JSON5`/`XML`/`JSONL`, `bun:ffi`, React
  Compiler, `--compile --asset`, isolated linker, `bun test --retry`, `bun:bundle` feature flags:
  no use here today.** Retry papers over flakes this suite doesn't have; feature flags would turn
  the deliberately-runtime `TEAMS_ENABLED` into a build matrix; the isolated linker has nothing to
  win at 35 packages.
- **Compression stays synchronous.** Measured (Bun 1.4 zlib-ng, M-series): brotli q5 on a ~22KB
  HTML page is ~18µs per response, gzip 6 ~11µs; ~23KB of CSS is the worst case at ~95µs. Three
  orders of magnitude under a database query — the async variants would add a promise hop to every
  response to save microseconds, and `zstd` a negotiation branch for the same nothing. Re-measure
  before touching this; the harness is in the `profiling` skill's ground rules.
- **`env = false` in `bunfig.toml`: rejected — but `--no-env-file` on the `start` script does the
  same job correctly.** The bunfig key would apply everywhere the repo runs, and local dev depends
  on `.env` while the suite depends on `.env.test`. The CLI flag scopes to one command: `bun run
  start` now ignores env files entirely, so production reads platform variables only and a stray
  `.env` in a container image can't shadow them. Dev and tests untouched.
- **`bun.lock` stays at `lockfileVersion: 1`.** Bun won't rewrite an unchanged lockfile, and v2's
  extra checks cover off-registry tarballs and git dependencies, neither of which this repo has. It
  migrates on the next dependency change; forcing it means a re-resolve and version drift for no
  benefit.

---

## Known issues and gotchas found on the way

- **WebKit applies `upgrade-insecure-requests` to `http://localhost` subresources.** Chrome
  exempts localhost; WKWebView rewrote every asset URL to `https://localhost:<port>` — which
  nothing serves — so pages loaded bare: no stylesheet, no client bundle, and the only symptom was
  a default-looking validation message. Found by the first `test:browser` run, invisible to every
  unit test and to anyone developing in Chrome. The directive now ships in production only, exactly
  like HSTS, with a test pinning its absence outside production.
- **The happy-dom preload leaves its own `fetch` installed** (it restores `Request`/`Response`/
  `FormData`, not `fetch`), and that fetch enforces the Same-Origin Policy against the fake window.
  Never mattered before because server tests call handlers directly. Anything in a test that
  genuinely needs the network — the browser smoke file polling its server subprocess — must use
  `Bun.fetch`.

- **bun-types 1.4 broke the route-literal generics.** `BunRequest.params` is now a mapped type
  over `keyof ExtractRouteParams<T>`, which never resolves for an unbound type parameter — the
  `destroy<T extends \`${string}:id${string}\`>` pattern failed on both sides of the handler
  boundary (passing `req` to helpers typed `BunRequest<string>`, and reading `params.id`).
  Controllers now take plain `BunRequest`; `params.id` types through the index signature. Also:
  `@types/bun@1.4.0` needs a current `@types/node` — the 24.x that happy-dom pulled in transitively
  fails typechecking inside bun-types itself, so it's pinned directly now.
- **A `bunfig.toml` keeps Bun 1.4 on the dev JSX runtime.** 1.4 documents `"jsx": "react-jsx"` as
  emitting `jsx` from `<pkg>/jsx-runtime`, but the mere presence of a `bunfig.toml` — any content,
  even empty — makes it emit `jsxDEV` from `<pkg>/jsx-dev-runtime`. Bisected to the file's
  existence; delete it and the import changes. Nothing breaks here because the import map carries
  both entries, which is why CLAUDE.md now says not to prune the "unused" one. **Worth reporting
  upstream** — not yet done.
- **Benchmarks can't be compared across time on shared hardware.** A first before/after pair
  appeared to show 1.4 making the suite 34% slower. Interleaving the two Bun versions on the same
  container showed them identical — the container had been rehosted onto a different CPU between
  recordings. `bench compare` now warns on a >30min gap and on a hardware mismatch, but the only
  real defence is measuring A and B together.
- **The rate limiter keyed on `x-forwarded-for`** — fixed; see Phase 3. The trusted-proxy decision
  landed as `TRUST_PROXY`, off by default. **A Railway deployment must set `TRUST_PROXY=true`** or
  every visitor shares the proxy's bucket; that's now a release-note item, not an open question.
- **`req.clone()` in `middleware/csrf.ts` is order-dependent** — pinned; see Phase 3. The catch
  now logs the ordering violation and a test documents the fail-closed behaviour.
- **`bun run wip restore` fails confusingly** if the tree has conflicting local changes: the real
  error is buried above a `git status` dump. Worked as designed, easy to miss when scripting.

---

## Before cutting the release

- [x] Bump `version` in `package.json` to `3.0.0` and rename `## Unreleased` in `CHANGELOG.md`.
- [x] Check the first CI run on 1.4 with parallel workers — green on GitHub's 4-vCPU runner:
      768 pass / 0 fail, suite 14.57s inside a 45s `Tests` job (was ~70s).
- [x] Browser check: nothing user-visible changed; README test counts updated (760+/70 files),
      API Reference already describes `Allow` generically so HEAD needs no edit.
- [x] The last-owner atomicity fix and TRUST_PROXY both lead the 3.0.0 changelog intro — the two
      things a fork can silently get wrong.

Remaining before merge: nothing code-side. Delete this file when the release ships.
