# Changelog

Billet is consumed by cloning or forking this repository, not by installing from npm. Tags and
this file are the only upgrade signals a fork gets, so anything that can silently break a fork
after a merge is documented here under **Breaking changes**.

Versions follow [semantic versioning](https://semver.org/): a major bump means a fork needs to
change its own code after merging.

## 3.0.0

Two independent lines of work: an audit against
[elsewhencode/project-guidelines](https://github.com/elsewhencode/project-guidelines) — its API
section (§9) and environment/dependency sections (§3–4) were where this repo had real gaps — and
the adoption of [Bun 1.4](https://bun.com/blog/bun-v1.4), which the toolchain now requires. The API
response shape and the Bun floor each make this a major on their own.

Two items deserve more attention than their diff size suggests. A fork running
`TEAMS_ENABLED=true` should take the **last-owner atomicity fix** (under Fixed): the failure needs
two owners racing within milliseconds and an org admin can recover it, but when it hits, an
organisation silently loses its last owner. And a fork deployed behind a reverse proxy must set
**`TRUST_PROXY=true`** (under Breaking changes) or the rate limiter throttles all visitors as one.

### Breaking changes

- **Requires Bun 1.4.0.** `.bun-version` and `engines.bun` are pinned to it, and CI installs from
  that file. A fork on 1.3.x must upgrade before merging. Nothing in `src/` changed for it — the
  suite is 755 pass / 0 fail on 1.4.0 exactly as it was on 1.3.11 — but the floor moved, and a
  fork's own code may not have been audited against 1.4's behaviour changes the way this one was.
- **`.env.test` now carries `DATABASE_URL` only.** Any other key in yours is inert — the preload
  overrides it — so a fork that had pinned values there should delete them rather than trust them.
  `DATABASE_URL` stays outside the pin deliberately: it is the one value that has to vary per
  machine and per workspace (`scripts/workspace.ts`), since two suites sharing a database truncate
  each other's tables mid-run.
- A fork that deliberately ran its suite against a non-default configuration — password mode, say —
  by putting it in `.env.test` no longer gets it. Set it per test case instead, the way the files
  covering password mode, the captcha and teams already do.
- **`GET /api/projects` returns a wrapped, paginated payload.** It was a bare `Project[]`; it is now
  `{ data: Project[], pagination: { total, limit, offset } }`, defaulting to 25 rows. A fork with a
  client reading `response.json()` as an array must read `.data`. `GET /api/projects/:id`, `POST`
  and `PUT` are wrapped in `data` too, and `GET /api/stats` returns `{ data: VisitorStats }`. The
  wrapper is what makes `total` expressible — and anything added later — without a second breaking
  change.
- **API errors return the shared JSON envelope**, not a text body. `{ error: { code, message,
  fields? } }` replaces `new Response("Project not found", { status: 404 })`. A fork asserting on
  the response text must assert on `error.code` instead — `not_found`, `invalid_id`, `invalid_json`,
  `invalid_body`, `invalid_limit`, `invalid_offset`, `method_not_allowed`,
  `unsupported_media_type`, `rate_limited`.
- **`rateLimit` returns that same envelope.** The 429 body changed from `{ error: "Too many
  requests" }` to `{ error: { code: "rate_limited", message } }` and now carries `Retry-After`.
  This affects the auth and team forms as well as the API, since they share the middleware.
- **`getProjects()` is unchanged, but the API no longer calls it.** `getProjectPage(limit, offset)`
  is the paginated read; the `/projects` HTML page still uses `getProjects()`.
- **`createMockRequest` returns a `BunRequest`** and takes a fourth `headers` argument. A string
  `body` is now sent verbatim rather than JSON-encoded, so a test can post a malformed body.
- **`@types/bun` moved to 1.4.0, and the route-literal generics are gone.** bun-types 1.4 rewrote
  `BunRequest.params` as a mapped type over `keyof`, which never resolves for an unbound type
  parameter — a controller written as `destroy<T extends \`${string}:id${string}\`>(req:
  BunRequest<T>)` stops compiling. This repo's four such controllers now take a plain `BunRequest`
  and read `params.id` through the index signature; a fork that copied the pattern into its own
  controllers must do the same after merging. `@types/node` is pinned directly now too — the 24.x
  that happy-dom pulled in transitively fails typechecking inside bun-types 1.4 itself.

- **The rate limiter keys on the client's socket address, not `x-forwarded-for`.** The header is
  client-controlled — a fresh value per request bought a fresh bucket, so the 5/min limit in front
  of `/login` could be walked past. **A fork deployed behind a reverse proxy must set
  `TRUST_PROXY=true`** (validated at boot; see `.env.example` and `runbooks/SECURITY.md` §5), or
  every visitor shares the proxy's address and one busy user rate-limits everyone. With it set,
  only the *last* header entry — the hop the trusted proxy added — is believed. The `x-real-ip`
  fallback is gone for the same reason.

- **`bun run start` no longer reads `.env` files** (`--no-env-file`). Production configuration
  comes from the platform's environment only, so a stray `.env` baked into a container image can't
  shadow it. A fork that deliberately configures production through an `.env` file on the server
  must remove the flag from the `start` script — or better, move those values into the platform's
  environment. `bun run dev` and the test suite still load `.env` / `.env.test` as before.
- **`upgrade-insecure-requests` ships in production only**, like HSTS. WebKit — unlike Chrome —
  applies the upgrade to `http://localhost` subresources, so in dev the directive rewrote every
  asset URL to an `https://localhost` origin nothing serves and pages loaded with no stylesheet or
  client bundle. Production responses are unchanged; only non-production CSP lost the directive.

### Added

- **Browser smoke tests** (`bun run test:browser`, `scripts/browser-smoke.test.ts`) on
  `Bun.WebView` — system WebKit on macOS, an installed Chrome elsewhere, zero new dependencies.
  Six journeys in about a second: home renders with a stylesheet, the client bundle hydrates its
  island, a guest submits the form through the CSRF round-trip with trusted input events, the
  captcha solves its proof of work in the page and the login submit carries it, a magic link
  scraped from the console email provider's output signs in end to end — including loading the
  link twice to prove GET doesn't redeem it, the invariant `runbooks/EMAIL.md` exists for — and
  the page console stays clean (which is where CSP violations surface). Deliberately separate from
  `bun run test`: the API is experimental and the engine varies by platform, so it never gates the
  deterministic suite. Its first run caught the `upgrade-insecure-requests` bug above.
- `bun run test:changed` — Bun 1.4's `--changed` walks the import graph backwards from uncommitted
  edits and runs only the affected test files. The middle ground between `test:file` and the full
  suite while iterating; the full suite remains the gate.
- **Graceful shutdown.** `registerShutdown` (`src/server/utils/shutdown.ts`) drains on
  `SIGTERM`/`SIGINT`: the cleanup sweep stops, `server.stop()` lets in-flight responses finish
  (Bun 1.4 resolves it when the last connection closes), then the pool closes via `closeDatabase`
  and the process exits 0. Deploys no longer sever requests mid-response. A second signal during
  the drain is ignored; an operator who can't wait has SIGKILL.
- The `profiling` skill (`.claude/skills/profiling/`): Bun 1.4's Markdown-format profilers
  (`--cpu-prof-md`, `--heap-prof-md`, `bun build --metafile-md`) and how to point them at this
  repo's server and client bundle.
- **HEAD works on every dispatched route.** `createRouteHandler` and `createApiRouteHandler`
  answered anything but the listed methods with a 405, and nothing lists HEAD — so crawlers and
  uptime monitors probing `/projects` or `/login` read the app as down. HEAD now runs the GET
  handler and strips the body in the dispatcher, and `Allow` advertises it next to GET. A resource
  with no GET still 405s.

- `src/server/controllers/api/request-guard.ts` — the guards every JSON endpoint runs, the mirror
  of `auth/form-guard.ts` for machine callers. `readJsonBody` rejects a non-JSON `Content-Type`
  (415) and an unparseable or non-object body (400); `readIdParam` rejects anything that isn't a
  positive integer in `serial` range; `readPagination` reads `?limit=`/`?offset=` and rejects
  out-of-range values rather than clamping them; `apiReadLimit` / `apiWriteLimit` are the per-IP
  budgets (60 and 20 per minute).
- `jsonError` and the `JsonErrorBody` type in `src/server/utils/response.ts`; `expectJsonError` in
  `src/server/test-utils/setup.ts`, which asserts the envelope and returns the parsed body.
- `createApiRouteHandler` in `src/server/utils/route-handler.ts` — JSON 405 with an `Allow` header.
  `createRouteHandler` now sends `Allow` too.
- `.bun-version` (1.3.11) and `engines.bun`, with `bun-version-file` on every `setup-bun` step in
  CI. `oven-sh/setup-bun` was installing the latest release, so the CI toolchain moved on Bun's
  release schedule rather than on a commit — on an app built on `Bun.SQL`, `Bun.password` and
  Bun's CSS bundler.
- `bun run audit` (`bun audit --audit-level=high`) and `.github/workflows/audit.yml`, on PRs and
  weekly. `.github/dependabot.yml` opens grouped weekly PRs for dependencies and pinned Action
  versions. See `runbooks/CI.md` §1b.
- `.editorconfig` for the files Biome doesn't format — migrations, workflows, shell scripts.
- An **API Reference** section in `README.md`, and a rewritten
  `.claude/skills/adding-a-feature/references/api-endpoint.md` teaching the guarded pattern.

### Changed

- **The suite runs in parallel, one worker per core, each with its own database.**
  `test-env.ts` rewrites `DATABASE_URL` from `BUN_TEST_WORKER_ID` (see
  `src/server/test-utils/worker-database.ts`); `run-tests.ts` creates and migrates the extra
  databases up front, idempotently, so only the first run on a machine pays for it. Slot 1 keeps the
  base name, so a single-worker run and `bun run test:file` use exactly the database they always did.
  Measured on the same tree and the same four-core host: **44.15s → 14.49s, 67% faster**, at 756
  pass / 0 fail across 68 files, holding across four consecutive runs. Cumulatively against the
  process-per-file runner this release replaced, 55.15s → 14.49s.
  `TEST_WORKERS=1` turns parallelism off, which is what you want when a failure needs a readable,
  ordered log instead of four interleaved ones.
- **`bun run test` runs one process with `bun test --isolate`**, not one process per test file.
  Isolation is the flag's job now: a fresh `globalThis` and cleared module registries per file, plus
  closing handles a file leaked, cancelling its timers and re-running the preloads — and one
  transpile cache shared across all 68 files instead of paid 68 times. Measured back to back on one
  host: **55.15s → 45.96s, 17% faster**, at an unchanged 755 pass / 0 fail across 68 files.
  `run-tests.ts` is now only migrations, `NODE_ENV`, a whole-run hang timeout and the slow-file
  report; the glob, the spawn loop and the output scraping are gone.
- `TEST_FILE_TIMEOUT_MS` is now **`TEST_TIMEOUT_MS`** and caps the whole run rather than each file
  (default 10 minutes, 30 in CI). Per-test timeouts are Bun's own `--timeout`.
- Per-file durations come from `--timings` (`.timings.json`, gitignored) rather than being timed by
  hand. The file is written slowest-first, so it doubles as the slow-test report — and it is what
  `--shard` and `--parallel` will read to balance by wall time.
- `bun run test:coverage` passes `--isolate` too, so it matches what `bun run test` does.
- **The test environment is set in one place: `src/server/test-utils/test-env.ts`**, preloaded into
  every test file by `bunfig.toml`. It pins `SESSION_COOKIE_NAME`, `AUTH_MODE`, `CAPTCHA_ENABLED`,
  `TEAMS_ENABLED`, `PORT`, `APP_URL`, `CRYPTO_PEPPER` and the app/email names. `run-tests.ts` no
  longer sets any of them, and `.github/workflows/ci.yml` no longer declares them either —
  `DATABASE_URL` is the only variable CI supplies.
- A preload is the only place the pin actually works. Imports are hoisted above a test file's body,
  so setting `process.env` there is too late for anything captured at import — `SESSION_COOKIE_NAME`
  in `services/sessions.ts`, `CRYPTO_PEPPER` in `utils/crypto.ts`. It also covers every entry point
  rather than one: `run-tests.ts` spawned children with a fixed env, so `bun run test` was safe
  while `test:file`, `test:coverage` and an editor's run-test button ran against whatever was in the
  developer's `.env` — a dev server in password mode, with the captcha on, or with teams enabled was
  enough to fail dozens of tests with no hint as to why.
- **`happy-dom` 20.8.3 → 20.12.0** (with `@happy-dom/global-registrator`), clearing three
  high-severity advisories the new audit found on its first run — two in `happy-dom` itself and one
  in its transitive `ws`. Both are devDependencies. One moderate advisory remains, in `resend` →
  `svix` → `uuid`, which is below the audit threshold and not fixable from here until `resend`
  ships an update.
- **`/api/stats` answers `GET` only.** It was registered as a bare handler, so it served its
  payload to any method, `DELETE` included. Every API route now goes through
  `createApiRouteHandler`.
- `POST /api/projects` sends a `Location` header, and 204s send a null body rather than `""`.
- `title` is trimmed and required on create and update. It was passed through unvalidated, so
  `{}` reached `createProject(undefined, null)` and the database.
- `bun run dev` uses `bun run --parallel --no-orphans` for the three watchers: name-prefixed
  output, and the watchers die with the terminal instead of orphaning on the port.
- A CSRF check that finds the request body already consumed logs the ordering violation
  (`checkCsrf` must run before `readFormValues` — Bun 1.4 makes `req.clone()` throw after a body
  read) instead of degrading to a silent 403; a test pins the fail-closed behaviour.
- `runbooks/CI.md` §1b: `bun audit fix` is the first move on an advisory, and `bun pm diff` — which
  reports new install scripts and new `child_process`/`fs`/`net`/`vm` imports between two published
  versions — is the pre-merge check for dependency bumps nobody here authored.
- **The cleanup sweep runs on `Bun.cron` instead of `setInterval`** — hourly on the hour, pinned to
  UTC (1.4 parses in-process cron schedules in local time). Runs can no longer overlap, the job has
  a real `unref()`/`stop()` for the shutdown path, and the cast guarding against happy-dom's
  browser-style `setInterval` is gone with the `setInterval`.

### Fixed

- **The last-owner invariant was not actually atomic.** `removeMember` and `updateMemberRole` put
  the guard inside the statement — an `EXISTS (… another owner …)` in the `WHERE` — which reads as
  atomic and isn't. Under Postgres's default READ COMMITTED, two concurrent removals of the last two
  owners each see the *other* owner, because neither has committed, so both pass and both commit.
  The organisation is left with **no owner**. Recoverable only if an org *admin* remains, since every
  team route gates on `admin` and an admin can promote someone back to owner — an org whose only
  admin-or-above members were the two owners is stuck. Write skew: row-level
  locking only serialises writes to the same row, and these touch different rows.
- Both statements now open with a `FOR UPDATE` CTE over the org's owner rows, so the second caller
  waits and, once the first commits, re-checks against what actually survived and is refused.
  `ORDER BY user_id` fixes the lock order against deadlocks. A fork on `TEAMS_ENABLED=true` should
  take this: measured against the unlocked statement, **24 of 25 concurrent attempts emptied the
  org**. `runbooks/TEAMS.md` §5 has the reasoning.
- The test that was supposed to catch it made a single attempt and passed by luck. It now repeats,
  and there is a matching one for concurrent demotions via `updateMemberRole`, which had the same
  bug. Running the suite in parallel is what surfaced it.
- **`scripts/workspace.ts destroy` now drops the per-worker test databases too.** It dropped exactly
  two names and required each to carry the workspace slug, so `…-test-w2`, `-w3`, … would have
  failed the ownership check and been left behind on every archive. It asks Postgres which exist
  rather than guessing at a core count, and only ever for children of a name that already passed the
  guard.
- **`bun run wip drop` now drops.** It pointed the ref back at `@{1}` with `git update-ref`, which
  *appends* to a reflog rather than rewriting it — and `wip list` reads the reflog. So the snapshot
  it claimed to drop stayed listed and stayed restorable, and the list grew by one entry on every
  drop (four drops took an eight-entry list to nine). It now uses `git reflog delete --updateref
  --rewrite`, the idiom git-stash's own `drop` uses, and deletes `refs/worktree/wip` once the last
  entry goes: emptying a reflog leaves the ref behind, and `list` would then print nothing at all
  rather than "no snapshots in this worktree".

## 2.3.0

### Added

- **Expired rows are now swept.** `src/server/services/cleanup.ts` starts an hourly timer from
  `main.ts` that deletes expired `user_tokens` and `sessions`, and — only with `TEAMS_ENABLED=true`
  — expired `organization_invites` that were never accepted. `cleanupExpired` had existed in
  `auth.ts` since the first release with no caller, so every fork has been accumulating dead rows
  in the two highest-churn tables in the schema.
- The sweep is **not** a correctness fix and forks should not treat it as one. Every read already
  filters `expires_at > CURRENT_TIMESTAMP` — in `auth.ts`, `sessions.ts`, `csrf.ts` and
  `invites.ts` — so an expired row has never been honoured whether or not it was still present.
  What the sweep buys is bloat control on guest sessions, which churn faster than anything else
  here, and the retention window `runbooks/PRIVACY.md` §7 asks for: a spent `user_tokens` row keeps
  a live-looking `token_hash` indefinitely, and a lapsed invite keeps the invitee's email address.
- **Accepted invites are kept**, expired or not. Migration `008` records acceptance with a
  timestamp rather than deleting the row precisely so it survives as the record of who joined via
  whom; the sweep's `accepted_at IS NULL` predicate is what preserves that. Revoked and lapsed
  invites are deleted once their original seven days are up.
- `startCleanupSweep()` returns a stop handle and its timer is `unref`'d, so it never holds a
  process or the test runner open. The first sweep runs immediately — a deploy that restarts more
  often than the interval would otherwise never sweep — and is not awaited at boot, so a database
  blip during it cannot stop the server listening. A rejection is logged and retried next hour
  rather than escaping the interval callback, where Bun would treat it as fatal.
- Every instance of a multi-instance deployment runs the sweep. That needs no lock: the statements
  are unconditional `DELETE`s over rows nothing can still use, so the losers of the race delete
  nothing.

### Changed

- `cleanupExpired` in `auth.ts` stays scoped to `user_tokens` and `sessions`. Invites are swept by
  `cleanupExpiredInvites` in `invites.ts`, composed by `cleanup.ts`, so auth never imports the team
  surface. `runbooks/TEAMS.md` §9 now lists `cleanup.ts` as the fifth reference to untangle when
  removing teams — the import is what `bun run check` reports if you miss it.

## 2.2.0

### Added

- Optional org-level user management, behind `TEAMS_ENABLED`. Unset (or `false`) keeps the
  existing behaviour exactly: `/team` and `/invites/accept` 404, no org is ever created, and the
  three tables migration `008` adds stay empty. Set to `true`, a signed-in user can create a team and
  then invite people by email, change their org role, and remove them. A value outside
  `true`/`false` stops the server at boot rather than silently 404ing the whole surface — the
  same treatment `AUTH_MODE` gets, and for the same reason.
- **Org role is a separate axis from `users.role`.** `users.role` (`'user' | 'admin'`) still
  means *platform operator* and still gates `/admin` via `requireAdmin`; it is untouched. The new
  `organization_members.org_role` (`'owner' | 'admin' | 'member'`) means standing inside one
  organisation. They
  are not merged on purpose: a platform operator answering a support ticket is not thereby an
  owner of a customer's org, and widening the existing `CHECK` would have made "org owner who is
  not a platform admin" inexpressible.
- `requireOrgRole` in `src/server/middleware/org.ts`, returning a discriminated union with the
  resolved session **and** membership, in the shape `requireAdmin` established. `membership.org.id`
  is the documented seam a fork uses to scope its own tables by org — core deliberately does not
  scope `project` or any other domain data.
- **Migration `008` adds tables and alters none**, so a fork that will never use teams can drop the
  feature without writing a migration against its own account data. Membership is a row in
  `organization_members` with a `UNIQUE` `user_id` rather than `org_id` / `org_role` /
  `org_joined_at` columns on `users`. The unique index keeps "one org per user" structural, and
  since the org, role and join date are one row, a half-removed member is unrepresentable rather
  than merely forbidden by a `CHECK`. Removal is the migration's `down` — three `DROP TABLE`s, none
  of which can reach a `users` row — and `runbooks/TEAMS.md` §9 lists the rest. A test asserts
  `users` has none of the three columns, so reintroducing one fails the suite.
- Invitations in their own `organization_invites` table, not a `user_tokens` type. Reusing
  `user_tokens` would have meant creating a shell `users` row per invited address, and because
  `signInWithPassword` reports `no-password` distinguishably from `invalid-credentials`, that
  would have turned `/login` into an oracle for "this address was invited to something once".
  Seven-day expiry, single-use, revocable, idempotent re-invite, capped and rate limited.
- Invite acceptance works in **both** auth modes. Magic-link mode signs the invitee in — the
  emailed token is the credential, exactly as a magic link is. Password mode asks a new invitee
  to choose a password; an address that **already** has one becomes a member but is sent to
  `/login` without a session, because mailbox control is grounds for a reset and never a sign-in.
  An invite accepted while signed in as a different account is refused, so forwarding the link
  can't turn it into a join-anyone link.
- A team must always have at least one owner, enforced inside the statement rather than around it
  — two owners demoting each other concurrently cannot leave the org unadministered. The template
  hides the control too, but the server is what decides.
- Both self-actions belong to somebody else: your own row has no `Remove` control and no role
  select, and the server refuses either. Granting ownership was already owner-only, so the only
  self-change the roles allowed was a demotion — which drops you below the `admin` minimum `/team`
  requires, with no way to undo it. Leaving a team is not shipped for the same reason: with one org
  per user, a member who left would need a fresh invitation to get back. See `runbooks/TEAMS.md` §8.
- Migration `008_add_organizations.ts`: `organizations`, `organization_members`, and
  `organization_invites`. It runs in every fork, flag or no flag, and all three stay empty when
  teams are off.
- `runbooks/TEAMS.md` — the role model, invite lifecycle, the authorisation checklist for new
  team routes, how to scope your own data, how to remove the feature, and what is deliberately not
  shipped.
- **`scripts/wip`, a per-worktree replacement for `git stash`.** Running several agents at once
  usually means a worktree each, and worktrees share one `.git` directory — so `refs/stash` is a
  single global stack and an agent that pops in its own checkout can silently take work another
  agent pushed seconds earlier. `bun run wip save|stash|list|show|restore|drop` snapshots to
  `refs/worktree/wip`, the one ref namespace git keeps per-worktree, so a snapshot is invisible to
  every other checkout. `restore` applies without dropping; losing a snapshot takes an explicit
  `drop`.
- **A checked-in `.claude/settings.json`**, registering one `PreToolUse` hook,
  `.claude/hooks/no-shared-stash.ts`, which denies `git stash` and prints the `wip` commands
  instead. `git stash create` and anything naming `refs/worktree/` pass through — that is how
  `scripts/wip` builds a snapshot. `.gitignore` stops ignoring both paths (`.claude/settings.local.json`
  is still ignored), and `tsconfig.json` now typechecks `.claude/hooks/**/*`. A fork that already
  keeps its own `.claude/settings.json` will hit a merge conflict here and should keep both hooks.
- **`scripts/workspace.ts`, giving each Conductor workspace its own port and databases.** The
  setup script copies one `.env` into every workspace, so all of them shared a dev database, a
  test database, port 3000 and a session cookie name. `provision` rewrites this workspace's
  `.env` with `PORT`/`APP_URL` from `CONDUCTOR_PORT`, a `DATABASE_URL` named `<base>-<workspace>`,
  and a workspace-specific `SESSION_COOKIE_NAME` — cookies are not scoped by port, so a sign-in
  on `:3001` was overwriting the session on `:3002`. `.env.test` gets a `DATABASE_URL` and nothing
  else, because `cleanupTestData` truncates every table and two agents on one `billet-test` fail
  each other's suites at random. It derives the base name from the **root** checkout, so re-running
  setup can't compound the suffix. `destroy` runs on archive and drops the pair, refusing any
  database whose name doesn't carry that workspace's slug — an unprovisioned workspace still points
  at the shared `billet`, and dropping that would take every other agent down with it. Both are
  no-ops where `CONDUCTOR_PORT` is unset (cloud workspaces, plain clones), so nothing changes for a
  fork that doesn't use Conductor.
- `.conductor/settings.toml` calls both, and sets `run_mode = "concurrent"` now that two
  workspaces can run `bun run dev` at once.

### Changed

- `run-tests.ts` pins `PORT=3000` and `APP_URL=http://localhost:3000` alongside the four variables
  it already pinned. Tests hardcode `http://localhost:3000` in request URLs and `csrf.test.ts`
  builds its expected Origin from `APP_URL`, so a workspace port leaking in from `.env` would 403
  every form post. `DATABASE_URL` is deliberately not pinned — that one is per-workspace on purpose.
- `Badge`'s `variant` union widens from `"admin" | "user"` to include `"owner"` and `"member"`,
  with matching classes in `src/client/components/badge.css`. Additive, but a fork that has
  restyled that file will want to add the two rules.
- `run-tests.ts` now pins `TEAMS_ENABLED=false` alongside `SESSION_COOKIE_NAME`, `AUTH_MODE` and
  `CAPTCHA_ENABLED`. Same reason as those three: a developer who runs the dev server with teams
  on has it in their `.env`, and leaked into a test run it breaks every `expect(404)` on a team
  route.
- `cleanupTestData` truncates the three new tables, and does the whole thing in one
  `TRUNCATE … RESTART IDENTITY CASCADE` rather than seven statements plus an `ALTER SEQUENCE`.
  Every test in the suite calls it and each round trip waits on an fsync under CI; one statement
  also checks its foreign keys once, at the end, so the table order stops mattering. A fork that
  has its own copy needs both changes.
- `.github/workflows/ci.yml` puts the Postgres cluster in `/dev/shm` (`PGDATA`, `--shm-size=1g`)
  and raises `TEST_FILE_TIMEOUT_MS` to 180s. Test data is disposable, so the fsync every
  `cleanupTestData` waits on buys nothing but wall clock; the per-file cap is a hang detector,
  and a runner is slower than a laptop, so the old value was killing files that only needed a few
  more seconds. The database and `APP_NAME` also lose a workspace-specific name (`san-jose-test`)
  for a neutral one. `runbooks/CI.md` has the detail.
- The homepage hero, `README.md`, the `package.json` description and the OpenGraph copy in
  `src/server/services/seo.ts` are reworded around "put your agents on rails" — the product is
  the guardrails, not the starter. Copy only, but a fork that has kept the stock hero and
  metadata will see them all move together, `public/og-image.png` included.
- **`/auth/callback` and `/auth/verify` answer both `GET` and `POST`.** The `GET` renders a
  confirm step and the `POST` spends the token, so a fork that has replaced either controller
  needs the second handler and the `createRouteHandler` entry. `/auth/callback` mints a guest
  session on the `GET` to sign its form's CSRF token; `/auth/verify` deliberately does neither,
  so a confirmation link still works from a mail client that keeps no cookies.
- `render()` in `src/server/utils/response.ts` takes an optional second argument of
  content-specific headers, used for the `Cache-Control: no-store` both confirm pages need.
  Purely additive — existing calls are unchanged, and `Content-Type` still can't be overridden.
- `Login` takes a `showConsoleHint` prop, and the "check the server console for the magic link"
  line only renders when it is true. It was unconditional, so every fork running a real mail
  provider was telling users to read a terminal they have no access to.

### Fixed

- **Guard denials were silent.** `requireAdmin` has always written its "Admin access required"
  message to the `"message"` flash key, but nothing ever read it — `stateHelpers` reads `"state"`
  — so a non-admin was bounced to `/` with no explanation and the cookie was dropped unread on
  the next request. `home` now renders it, which fixes `requireAdmin` as well as the new guard.
  If you were debugging that, it wasn't you. The payload is `FlashMessage` — `text` plus a
  required `type` — because the same key carries "Admin access required" and "You've joined Acme",
  and a default would have rendered one of them in the wrong style. `/login` reads it too, since
  that is where invite acceptance sends an account that already has a password.
- **Email bodies interpolated every field into HTML unescaped.** Harmless until now, since the
  only values were URLs the server built and env vars the operator set — but the invite is the
  first email carrying text a user typed, and an org name of `<a href="…">` would have rendered
  as live markup in every invitee's inbox. `renderActionHtml` now escapes at the render boundary,
  so no future email can reintroduce the hole by forgetting, and the subject is stripped of
  CR/LF against header injection. The plaintext body is unchanged.
- **Mail scanners spent single-use links before the recipient could.** Corporate mail security
  (Microsoft Defender Safe Links and friends) fetches every URL it delivers, and both
  `/auth/callback` and `/auth/verify` redeemed on `GET` — so the token was gone before the click,
  and the visitor landed on a login form or an "invalid link" page that explained nothing. Both
  now render a confirm step and redeem on `POST`: scanners follow links, they don't submit forms.
  `runbooks/EMAIL.md` §5 has the rule for any new emailed link, and why the CSRF treatment of the
  two differs.
- **`/login` ignored the `?error=` it was redirected with.** Every dead end in the sign-in flow
  sends the visitor to `/login?error=…`, and the page rendered a pristine form instead of the
  message. Flash state still wins where both are present, and the query value is capped and
  rendered as text.
- **The dev bundle could be served mid-rebuild, and stay broken for an hour.** `bun build --watch`
  rewrites `dist/assets/*` in place, so a reload can read the file while it is half-written —
  and `serveFile` streamed those zero bytes as a `200` carrying `max-age=3600`, which is what
  made the stylesheet "just not load" and then stay unloaded. Dev bundles now go through
  `serveDevBundle` (`src/server/utils/static-files.ts`), which reads the whole file into memory,
  answers an empty read with `503` + `Retry-After` instead of caching it as valid, and sets
  `no-store` throughout. A bad moment costs one reload.
- **A missing bundle answered `404`, which browsers treat as settled.** `handleFallback` now
  checks the name against `BUNDLE_FILENAMES`, so `/assets/main.css` with no build behind it is a
  `503` — build state the next `bun run build` fixes — while `/assets/typo.js` stays a `404`.
  `warnOnMissingDevBundles()` says the same thing at boot, and `bun run dev` builds once before
  starting the watchers.
- **`assets.test.ts` deleted the real `dist/assets`.** It built its fixtures in the live directory
  and `rmSync`'d the whole thing in `afterAll`, so running that one file from an editor's test
  button left the running dev server with no bundles and every page unstyled until someone ran
  `bun run build`. Every read of the directory now goes through `assetsDir()`, and
  `setAssetsDirForTest()` overrides it; pass `null` in an `afterEach` to restore. A fork with its
  own asset tests must call it before touching that directory. Deliberately not an env var —
  `--outdir ./dist/assets` is fixed in `package.json`, so pointing a deployment elsewhere would
  only break boot.

## 2.1.1

### Changed

- The **Set your password** link on the `/login` no-password notice now carries the address
  that was just typed, and `/forgot-password` prefills its email field from `?email=`. The
  reset still takes a deliberate click — a server-side auto-submit has no captcha solution to
  present and would spend the shared auth rate limit on a failed sign-in. A flash value wins
  over the query param, and only an address-shaped param is accepted.

## 2.1.0

### Added

- Optional password auth, behind `AUTH_MODE`. Unset (or `magic-link`) keeps the existing
  behaviour exactly; `password` swaps in email-and-password credentials with argon2id hashing
  via `Bun.password` — no new dependency. The two modes are mutually exclusive: with both,
  every account would have two ways in and the weaker one would set the ceiling. An
  `AUTH_MODE` value outside the two stops the server at boot rather than silently falling back.
- `/signup`, in **both** modes. Magic-link mode emails a link with sign-up wording; password
  mode takes an email and password and signs the user straight in.
- `/account`, in both modes: email address, verification status, and — in password mode only —
  a change-password form that keeps the current session and signs the user out everywhere else.
  An account carried over from magic-link mode has no password yet, so it gets a set-password
  form there instead; which of the two runs is decided from the account's own state, never from
  the fields the form submits. Setting a first password signs the user out everywhere else too —
  the account gains a credential, and anything else holding a session predates it — and both the
  form and the confirmation say so.
- A signed-out user whose account predates the switch to password mode is told so when they
  try to sign in, and linked to `/forgot-password` to set a first password. Sign-in otherwise
  gives one message for a wrong password and an unknown address; this case is the deliberate
  exception, because there is no password such a user could type correctly. It does make
  `/login` report whether an address is a registered carried-over account — see the enumeration
  posture in `SECURITY.md` for the trade and how to revert it in a fork.
- Password reset by email (`/forgot-password`, `/reset-password`) and email verification
  (`/auth/verify`, `/auth/verify/resend`). All four 404 in magic-link mode. `/auth/verify`
  renders its own result page rather than redirecting into `/account`, so a link opened from a
  mail client with no session still shows the outcome.
- `users.email_verified_at`, with a fixed banner reminding unverified users to confirm.
  Nothing is gated on it — forks add their own gating. Magic-link sign-in stamps it (clicking
  the link proves ownership), so the banner only ever appears in password mode.
- Migration `007_add_password_credentials.ts` adds `users.password_hash` and
  `users.email_verified_at`, both nullable, and backfills existing users as verified.

### Changed

- `User` gains `email_verified_at: Date | null`. Any fork constructing a `User` literal —
  test fixtures, factories, seed data — needs the field.
- `Layout` renders the verification banner and sets `data-banner` on `<body>`; `Nav` gains an
  Account link. A fork with a customised `src/server/components/layouts.tsx`,
  `nav.tsx`, or `templates/login.tsx` will hit merge conflicts in those files.
- The magic-link token helpers in `services/auth.ts` are now `createUserToken` /
  `consumeUserToken`, generalised over a token type. `createMagicLink` and `verifyMagicLink`
  keep their signatures and behaviour.
- `signInWithPassword` returns a `SignInResult` discriminated union rather than `User | null`,
  matching the other result types in `services/passwords.ts` and carrying the reason a sign-in
  failed. A fork calling it directly needs `result.success` / `result.user` instead of a null
  check — note that the old `if (!user)` still compiles against the new type and is always
  false, so the compiler will not catch this for you.
- The layered bot defence (rate limit → honeypot → captcha) moved out of the login controller
  into `controllers/auth/form-guard.ts` and now runs on `/signup` and `/forgot-password` too.
  A honeypot or captcha failure hands the parsed body back to the caller, so `/reset-password`
  can re-render behind the token the visitor already has instead of sending them off to request
  a new email over a stale challenge. `/forgot-password` preserves the typed address across a
  rejected submission, the way `/login` and `/signup` do.
- The honeypot feign is mode-aware. Magic-link mode still borrows "check your email"; password
  mode borrows the transient-failure message instead, because claiming a link was sent to an app
  with no links strands a human who tripped it by autofill.
- `regenerateSession` (and `verifyMagicLink`'s second argument) now take the raw session id from
  the request cookie rather than one the caller resolved first, and discard it whatever its type.
  Resolving it first created a guest session for a cookieless visitor purely to delete it a line
  later, and signing in while already signed in left the old row behind as an orphan.
- `robots.txt` disallows `/account` alongside `/admin`, `/api/`, and `/auth/`.
- `test-utils/run-tests.ts` now pins `AUTH_MODE=magic-link` and `CAPTCHA_ENABLED=false`
  alongside `SESSION_COOKIE_NAME`. Running the dev server in password mode or with the captcha
  on puts those in your `.env`, and leaked into the suite they fail every test that posts to an
  auth form.

## 2.0.0

### Breaking changes

**One JSX runtime: Preact replaces React on the server.** The server used React purely as a
JSX-to-string function — no hooks, context, Suspense, or portals — so it now compiles with
`jsxImportSource: preact` and renders through `renderToString` from `preact-render-to-string`.
`react`, `react-dom`, `@types/react`, and `@types/react-dom` are gone.

If you carry a fork, merging this requires three changes in your own code:

- **Write SVG presentation attributes in kebab-case.** Preact passes attribute names through
  verbatim where React rewrote them, so `strokeWidth` reaches the browser unrecognised and the
  stroke renders at the default width. There is no error and no failing test — the SVG just looks
  wrong. Rename `strokeWidth` → `stroke-width`, `strokeLinecap` → `stroke-linecap`, and so on for
  every presentation attribute in your JSX. Both renderers emit the kebab-case form identically,
  so the fix is safe to apply before you merge.
- **Swap React types for Preact ones.** `React.ReactNode` becomes `ComponentChildren`, and `JSX`
  type imports come from `preact`. `dangerouslySetInnerHTML` is unchanged.
- **Drop the `@jsxImportSource preact` pragma comments from client islands.** Preact is the default
  runtime now, so the per-file pragma that opted back out of React is redundant.

Text escaping is also less aggressive — a literal `'` where React emitted `&#x27;`. Both are valid
HTML and both escape the injection-relevant characters, but a test asserting on the entity will
need updating.

`preact` is a runtime **dependency**, not a devDependency: the server imports its JSX runtime, so a
production install without it won't boot. The client bundle marks it `--external` and resolves it
from the import map in `src/server/components/layouts.tsx` — keep that pinned version in step with
`package.json`.

### Added

- Optional first-party proof-of-work captcha on `/login`, behind `CAPTCHA_ENABLED`, alongside a
  honeypot field and rate limiting. No third-party service.
- Brotli and gzip response compression.
- SEO defaults: sitemap, `robots.txt`, structured data, canonical URLs, per-page meta, and
  `theme-color`.
- AI-assistant discovery: `llms.txt`, discovery headers, and a dynamic web manifest.
- Accessibility baseline: focus rings, reduced-motion support, form labels, and table semantics.
- Privacy, Security, Accessibility, SEO, Email, and CI runbooks under `runbooks/`.
- GitHub Actions CI pipeline.
- Process-isolated test runner that applies migrations first and pins `SESSION_COOKIE_NAME`.

### Changed

- `CLAUDE.md` reorganised around gotchas, with detail moved into skills that load on demand.
- Expired CSRF tokens now re-render the form with the user's input intact instead of discarding it.
- Postgres pool hardened; Railway healthcheck added and the builder switched to Metal.
- All environment variables are required at boot — `validateEnv()` exits on a missing one.
- `SESSION_COOKIE_NAME` is configurable via env.

### Removed

- `react`, `react-dom`, `@types/react`, `@types/react-dom`.
- The unused `APP_ORIGIN` environment variable.

## 1.0.0

Initial tagged release.
