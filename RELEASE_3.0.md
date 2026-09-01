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

Suite: **55.15s → 14.49s** (process-per-file → 4 workers), 756 pass / 0 fail across 68 files.
Isolate alone was 55.15 → 45.96; parallelism took 44.15 → 14.49 on the same tree.

---

## Phase 2 — next up

### Graceful shutdown  ·  small, clear win

There is no `SIGTERM` handler anywhere in `src/server`, so every Railway deploy severs in-flight
requests. Bun 1.4's `server.stop()` now closes idle keep-alives immediately, closes busy ones once
their response is sent, and resolves when the last connection closes — which is what makes a handler
worth writing at all.

About fifteen lines in `src/server/main.ts`: on `SIGTERM`/`SIGINT`, stop the cleanup sweep,
`await server.stop()`, `await db.close()`, exit. Worth a test that the handler is registered and
ordered; the socket behaviour itself is Bun's.

### `Bun.cron()` for the cleanup sweep  ·  small, clear win

`src/server/services/cleanup.ts` uses `setInterval` plus a cast that exists only because the
happy-dom preload can swap in a browser-style `setInterval` with no `unref`:

```ts
(timer as { unref?: () => void }).unref?.();
```

`Bun.cron()`'s in-process overload replaces it, guarantees runs never overlap, and has a real
`unref()` and `stop()` the shutdown handler above can call.

**Trap:** 1.4 parses in-process cron schedules in **local time**. Pass `{ tz: "UTC" }` or the sweep
moves when a host's zone does.

### HEAD returns 405 on every dispatched route  ·  small, confirmed

Measured against a live 1.4 server: `HEAD /` answers 200 (bare handler), while `HEAD /projects`,
`/forms`, `/login` and `/api/projects` all answer **405** — every route through
`createRouteHandler` or `createApiRouteHandler`.

HEAD should return what GET would without a body, and `compression.ts` already strips the body for
it. Bun's own per-method route objects gained this in 1.4; our dispatcher never had it. Crawlers and
uptime monitors use HEAD, and it's a `specification.website` line item. A few lines in
`src/server/utils/route-handler.ts` plus a test.

---

## Phase 3 — tooling and docs

- **`bun run --parallel` for the dev script.** Replaces `(bun run dev:client & … & …)` with
  name-prefixed output. Pair with `--no-orphans` so the watchers die with the terminal — the exact
  hazard the CLAUDE.md working agreement warns about in prose.
- **Supply-chain commands.** `bun audit fix` replaces the "usually `bun update <pkg>`" advice in
  `runbooks/CI.md` §1b. `bun pm licenses --prod --json` closes §11 of the guidelines audit, the one
  section that was clean but had no mechanism. `bun dedupe --check` as a CI step. `bun pm diff`
  belongs next to the Dependabot section — it reports new install scripts and new imports of
  `child_process`, `fs`, `net`, `vm` between two versions, which is what you want before merging a
  bump.
- **Markdown profiles.** `--cpu-prof-md`, `--heap-prof-md`, `bun build --metafile-md` emit profiles
  and bundle analyses as Markdown tables rather than binary an agent can't open. Same idea as the
  rest of the repo; wants a short skill rather than a CLAUDE.md paragraph.
- **`env = false` in `bunfig.toml`** so a stray `.env` can't be picked up where variables come from
  the platform.
- **Measure before rewriting compression.** `compression.ts` calls `brotliCompressSync` /
  `gzipSync` on the response path, blocking the loop per response. 1.4's zlib-ng makes that cheaper
  without changing the shape; the async variants would fix it, and `zstd` is now available at the
  cost of another negotiation branch. Good first customer for `--cpu-prof-md` — measure, then
  decide.
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
- **`Bun.WebView`, `Bun.Image`, `Bun.Terminal`, `Bun.Archive`, `Bun.JSON5`/`XML`/`JSONL`,
  `bun:ffi`, React Compiler, `--compile --asset`: no use here today.** WebView is the near-miss — a
  real headless browser with no install, which would make browser smoke tests nearly free — parked
  because automated a11y testing was passed on.
- **`bun.lock` stays at `lockfileVersion: 1`.** Bun won't rewrite an unchanged lockfile, and v2's
  extra checks cover off-registry tarballs and git dependencies, neither of which this repo has. It
  migrates on the next dependency change; forcing it means a re-resolve and version drift for no
  benefit.

---

## Known issues and gotchas found on the way

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
- **The rate limiter keys on `x-forwarded-for`**, which is client-controlled, so a fresh header value
  per request gets a fresh bucket and the 5/min limit in front of `/login` can be walked past. Not
  yet fixed: it needs a trusted-proxy decision, not just a line change, since behind Railway the
  real client address only exists in that header. Flagged in the guidelines audit, still open.
- **`req.clone()` in `middleware/csrf.ts` is order-dependent.** 1.4 throws once a body has been
  read, naming `Bun.serve` route-handler requests specifically. It works today because all four
  callers check CSRF before `readFormValues`, and the signed-out auth forms never call `checkCsrf`
  at all. The `try/catch` swallows the `TypeError`, so a violation degrades to a **silent 403**
  rather than a crash. Untested invariant — worth one test pinning the order.
- **`bun run wip restore` fails confusingly** if the tree has conflicting local changes: the real
  error is buried above a `git status` dump. Worked as designed, easy to miss when scripting.

---

## Before cutting the release

- [ ] Bump `version` in `package.json` to `3.0.0` and rename `## Unreleased` in `CHANGELOG.md`.
- [ ] Check the first CI run on 1.4 with parallel workers — this has only been exercised on a
      4-core container, never on hardware we don't control. The `Tests` job should drop from ~70s to
      ~20s.
- [ ] Browser check: nothing user-visible changed, but the API Reference and README counts did.
- [ ] Consider whether the last-owner atomicity fix warrants its own release note prominence — a
      fork on `TEAMS_ENABLED=true` should take it. Severity is narrow (needs two owners acting
      within milliseconds, and an org admin can still recover it) but the failure is silent.
