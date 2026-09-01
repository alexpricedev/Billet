# CLAUDE.md

Billet is a server-rendered full-stack TypeScript app on Bun + PostgreSQL. Requests flow
route → controller → service → template. `README.md` has the directory tree; the code is the
spec for everything else. This file is for the things you can't learn by reading the repo.

## Working agreements

- The dev server is already running in another tab, on this workspace's own port — don't start
  one, and don't add a second. `bun run dev` here will fail on the port or fight the watcher.
  Read `PORT` from `.env` rather than assuming 3000; only the root checkout is on 3000.
- Run test and lint suites through the `package.json` scripts (`bun run test`, `bun run check`).
  Invoking `bun test` directly skips migrations, so it runs against whatever schema is already
  there — see the `verifying-changes` skill. The test environment itself is safe either way; it
  is pinned by a preload, not by the runner.
- Write code that reads like the surrounding code: match its comment density, naming, and idiom.
- When you try several approaches to a problem, delete the ones you abandoned before you finish.
- Check work in the browser with the `/browse` skill when the change is user-visible.
- Never `git stash`. Use `bun run wip` — see "The stash is shared, the worktrees are not".

## Gotchas

### The stash is shared, the worktrees are not

This repo is usually checked out several times at once — one worktree per agent — over a single
shared `.git` directory. `refs/stash` lives in that shared directory, so the stash is **one global
stack**: an agent that pops in its own worktree can pop the changes another agent pushed seconds
earlier, and neither of them sees anything go wrong until the work is gone.

`refs/worktree/*` is the one ref namespace git keeps per-worktree. `scripts/wip` (run it as
`bun run wip`) snapshots to `refs/worktree/wip`, which no other worktree can read, list, or drop:

```
bun run wip save [message]     snapshot tracked changes, working tree left alone
bun run wip stash [message]    snapshot, then revert tracked changes (git reset --hard)
bun run wip list               this worktree's snapshots, newest first
bun run wip show [n]           diffstat for snapshot n (default 0)
bun run wip restore [n]        apply snapshot n and keep it
bun run wip drop               forget the newest snapshot
```

`restore` applies without dropping — losing a snapshot takes an explicit `drop`, which is the
whole point. Snapshots cover tracked changes only; untracked files are never touched, so they
survive `wip stash` in place. `save` warns and lists them.

A `PreToolUse` hook (`.claude/hooks/no-shared-stash.ts`, wired in `.claude/settings.json`) denies
`git stash` outright and prints the table above. `git stash create` and anything naming
`refs/worktree/` are allowed through — that is how `scripts/wip` does its work.

### Each workspace owns its port and its two databases

`scripts/workspace.ts provision` runs from the Conductor setup script and rewrites this
workspace's env files: `.env` gets `PORT` / `APP_URL` from `CONDUCTOR_PORT`, a `DATABASE_URL`
named `<base>-<workspace>`, and a workspace-specific `SESSION_COOKIE_NAME` (cookies aren't scoped
by port, so two workspaces on localhost otherwise overwrite each other's session). `.env.test`
gets `DATABASE_URL` **only**, because that is the only key it carries at all — every other
variable the suite needs is pinned by `src/server/test-utils/test-env.ts` (see "One preload sets
the test environment"). A workspace port must never reach the tests: they hardcode
`http://localhost:3000` in request URLs and `csrf.test.ts` builds its expected Origin from
`APP_URL`, so the two disagreeing 403s every form post.

The test database is the reason this exists: `cleanupTestData` truncates every table, so two
agents sharing one `billet-test` fail each other's suites in ways neither can reproduce.

`provision` is idempotent — it derives the base database name from the **root** checkout's `.env`,
never from this workspace's, so re-running setup can't compound the suffix. `destroy` runs on
archive and drops both databases, but only after checking the name carries this workspace's slug:
a workspace that was never provisioned still points at the shared `billet`, and the guard refuses
it rather than dropping the database every other agent is using. Both are no-ops in cloud
workspaces, where `CONDUCTOR_PORT` is unset and there is one checkout anyway.

### One JSX runtime, two execution models

Everything compiles with Preact (`jsxImportSource: preact` in `tsconfig.json`) — there is no React
in this project. What differs is *when* the JSX runs, and the `src/server/` vs `src/client/` split
is the signal:

- **`src/server/`** renders once through `renderToString()` from `preact-render-to-string` and ships
  as HTML. It never hydrates, so `useState` in a server template does nothing.
- **`src/client/`** mounts into the live DOM with `render()` from `preact` and is fully interactive.

`preact` is a runtime **dependency**, not a devDependency — the server imports its JSX runtime, so a
production install without it won't boot. The client bundle marks it `--external` and resolves it
from the import map in `src/server/components/layouts.tsx`, so the version pinned there must stay in
step with `package.json`.

The import map carries **both** `preact/jsx-runtime` and `preact/jsx-dev-runtime`, and both are
`--external` in the client build. Neither is dead weight. Bun 1.4 documents `"jsx": "react-jsx"` as
emitting `jsx` from `<pkg>/jsx-runtime`, but the mere presence of a `bunfig.toml` — any content, even
empty — makes it emit `jsxDEV` from `<pkg>/jsx-dev-runtime` instead. This repo has one, so the
bundle and the server both use the dev runtime. Reproduce it by deleting `bunfig.toml` and
rebuilding; the import changes. Whichever way Bun settles this, both entries are mapped, so nothing
breaks — which is the only reason it isn't a live bug here. Don't prune the "unused" one.

**Write SVG attributes in kebab-case** (`stroke-width`, not `strokeWidth`). Preact passes camelCase
attribute names through verbatim, and the HTML parser doesn't recognise `strokeWidth` — the stroke
silently renders at the default width. React used to rewrite these; nothing does now.

No Web Components. Shadow DOM and custom-element lifecycles need browser infrastructure to test;
pure functions and Preact islands are both testable under `bun:test`.

### Service tests mock the DB module before importing the service

`src/server/services/*.test.ts` call `mock.module("./database", ...)` and *then* import the
service under test. The imports sit below executable code on purpose — that ordering is what
makes the mock take effect. Don't tidy it.

### The test runner is a script, not `bun test`

`bun run test` runs `src/server/test-utils/run-tests.ts`, which applies migrations first and spawns
one process per test file (isolation + a per-file timeout). Both matter: `bun test` on its own uses
whatever schema is already in the database, and several files interfere when they share a process —
`team.test.ts` and `login.test.ts` in one run fail two invite tests that pass individually.

It sets no environment of its own beyond `NODE_ENV`. That belongs to the preload below.

### One preload sets the test environment

`bunfig.toml` preloads two modules into *every* test file:

- `src/server/test-utils/test-env.ts` pins the whole environment — `SESSION_COOKIE_NAME`,
  `AUTH_MODE`, `CAPTCHA_ENABLED`, `TEAMS_ENABLED`, `PORT`, `APP_URL`, `CRYPTO_PEPPER`, and the
  email/app names. Tests hardcode `session_id` and `http://localhost:3000`, and assume the shipped
  defaults; running the dev server in password mode, with the captcha on, or with teams enabled
  puts the opposite in your `.env`, and Bun loads that for every test run.
- `src/client/test-utils/setup.ts` registers happy-dom globals and then restores Bun's native
  `Request`/`Response`/`FormData` — server tests depend on that restore.

A preload is the only place the pin works. Imports are hoisted above a file's body, so a test that
assigns `process.env.SESSION_COOKIE_NAME` at the top has already missed it: `services/sessions.ts`
read the value as it was imported, and `utils/crypto.ts` did the same with `CRYPTO_PEPPER`. It is
also why the pin isn't in `run-tests.ts` any more — that only ever covered `bun run test`, leaving
`test:file`, `test:coverage` and an editor's run-test button exposed.

So `.env.test` carries `DATABASE_URL` and nothing else, and adding anything else to it is
pointless: the preload overrides it. Files that exercise password mode, the captcha, or teams set
the variable themselves per case, at runtime, which is long after preload.

### Auth is one mode or the other, never both

`AUTH_MODE` (`src/server/services/auth-mode.ts`) is `magic-link` (default) or `password`. The two
are mutually exclusive on purpose. `/forgot-password`, `/reset-password`, `/account/password`,
and `/auth/verify*` all `render404()` from inside their controllers when the mode is wrong — the
route table in `routes/app.tsx` is static, so a route existing tells you nothing about whether it
answers. `/login`, `/signup`, and `/account` exist in both modes and branch on
`passwordAuthEnabled()`.

`authMode()` reads `process.env` on every call so tests can flip it mid-file; an invalid value is
fatal at boot in `validateEnv()`.

Every emailed link renders a confirm step on `GET` and spends its token on `POST` — mail security
scanners fetch each link they deliver, and a `GET` that redeemed would burn the token before the
recipient clicked. `runbooks/EMAIL.md` has the rule and the reason `/auth/callback` is CSRF-checked
while `/auth/verify` deliberately isn't.

### Two role axes, and they must never merge

`users.role` (`'user' | 'admin'`) is the **platform operator** flag. It gates `/admin` via
`requireAdmin` and nothing else touches it.

`organization_members.org_role` (`'owner' | 'admin' | 'member'`, migration `008`) is standing
inside **one organisation**, behind `TEAMS_ENABLED` (`src/server/services/teams-mode.ts`, a
boolean, fatal at boot on anything but `true`/`false`). It gates `/team` via `requireOrgRole`
(`src/server/middleware/org.ts`), which returns the resolved membership the way `requireAdmin`
returns the context.

Do not widen `users_role_check` to hold org roles: "org owner who is not a platform admin" is the
common case and merging the axes makes it inexpressible. Team forms name the field `org_role`,
never `role`, so a copy-paste can't write a member's input into the platform flag.

Migration `008` adds three tables and **alters nothing**. Membership is a row in
`organization_members` (`user_id` UNIQUE, so one org per user is structural) rather than columns on
`users`, because that is what makes the feature removable: a fork that doesn't want teams deletes
the migration and the team code, or runs `down` for three `DROP TABLE`s that cannot reach an
account row. Never add an org column to `users` — you would be handing every fork a migration to
write against live account data. Scope your own tables instead; `runbooks/TEAMS.md` has the seam.

Every `:id` in a team route is scoped `WHERE user_id = $1 AND organization_id = $2`. The guard
proves you administer *an* org, not that the row you named is in it — nothing else catches that.
The last-owner rule lives inside the `UPDATE`/`DELETE`, not around it; the hidden button is
cosmetic.

Core does not scope domain data by org — `runbooks/TEAMS.md` has the seam and the reasoning.

### Passwords are read raw, and never round-trip through flash state

`readFormValues` (`src/server/utils/form-data.ts`) trims values and drops empties — **unsafe for
credentials**, because whitespace is part of a password. Password controllers use `readPassword`
from `src/server/controllers/auth/form-guard.ts` instead, which reads the field verbatim.

Flash state is an HMAC-signed but client-readable cookie. A failed auth form preserves the email
address and nothing else. Never add a password to it.

Password hashing lives in `src/server/utils/crypto.ts` and is deliberately *not* peppered with
`CRYPTO_PEPPER`, unlike everything else in that file — see the comment there and `SECURITY.md`.

### Security headers and CSP are centralised

Every response gets its headers from `secureRoutes` / `handleGuarded` in
`src/server/utils/security-headers.ts`. Controllers set only content-specific headers.

The CSP script allowlist is `'self' 'unsafe-inline' https://unpkg.com https://esm.sh`. Any new
third-party script needs the CSP entry, an SRI `integrity` hash, and ideally a `preconnect` in
`layouts.tsx` — otherwise it is silently blocked in the browser but passes every test.

### An uncaught throw in an API controller becomes an *HTML* 500

`handleGuarded` catches everything and answers with `render500()` — the styled HTML error page —
whatever the route was. So a bare `await req.json()` on a malformed body sends an error page to a
JSON client and logs the request as a server fault, for what was the caller's typo.

`src/server/controllers/api/request-guard.ts` is the fix, and every `/api` controller opens with
it: `readJsonBody` (415 on the wrong `Content-Type`, 400 on unparseable or non-object),
`readIdParam`, `readPagination`, and `apiReadLimit` / `apiWriteLimit`. Errors go through
`jsonError` in `utils/response.ts` — one `{ error: { code, message } }` envelope, shared with the
rate limiter, with a stable `code` and a `message` no test should assert on.

API routes use `createApiRouteHandler`, not `createRouteHandler` — same method dispatch, JSON 405.
Both send `Allow`. Use it even for a one-method resource: a bare handler in a Bun routes map
answers *every* method.

### Env is validated at boot and `APP_URL` is load-bearing

`validateEnv()` exits the process on a missing var, then migrations run before `Bun.serve()` — a
failed migration means no server. `src/server/services/database.ts` throws at import time without
`DATABASE_URL`, so anything that imports it (directly or not) needs the env set.

`APP_URL` must include the port. CSRF origin validation compares the request `Origin` against it
exactly, so `http://localhost` vs `http://localhost:3000` rejects every form post with a 403.

### Assets are only fingerprinted in production

`initAssets()` and `getAssetUrl()` no-op unless `NODE_ENV=production`, so asset URLs differ between
dev and prod. In production the files must already exist in `dist/assets` or startup throws.

The un-hashed dev bundle is served by `serveDevBundle` (`src/server/utils/static-files.ts`), not
`serveFile`, and that distinction is load-bearing. `bun build --watch` rewrites `dist/assets/*` in
place, so a reload can read the file mid-write; `serveFile` would stream those zero bytes as a 200
carrying `max-age=3600`, and the stylesheet would stay missing for an hour. `serveDevBundle` reads
the whole file into memory, answers an empty read with a 503 + `Retry-After`, and sets `no-store`
throughout — so a mid-rebuild request costs one reload, never a cached blank.

A bundle that is *absent* rather than empty gets the same 503, not a 404: `handleFallback` checks
the name against `BUNDLE_FILENAMES` (`src/server/services/assets.ts`), so `/assets/main.css` with
no build behind it reads as build state the next `bun run build` fixes, while `/assets/typo.js`
stays a 404. `warnOnMissingDevBundles()` says the same thing at boot, and `bun run dev` builds once
before starting the watchers.

Anything that reads or writes `dist/assets` in a test must call `setAssetsDirForTest()` first.
`assets.test.ts` used to build its fixtures in the real `dist/assets` and `rmSync` the whole
directory in `afterAll` — running that one file (`bun test src/server/services/assets.test.ts`, an
editor's test button) deleted the running dev server's bundles, and every page went unstyled until
someone ran `bun run build`. Every read of the directory goes through `assetsDir()`
(`initAssets`, `handleAssetRequest`, `warnOnMissingDevBundles`, and `handleFallback`) so the
override covers all of them; pass `null` in an `afterEach`/`finally` to restore it. It is
deliberately not an env var — `--outdir ./dist/assets` is fixed in `package.json`, so pointing a
deployment somewhere else would only break boot.

### Linting

Biome runs with `recommended` on and `noConsole: error` — use `log` from
`src/server/services/logger.ts` in server code. Test files, `logger.ts`, the database CLI/seed
scripts, and `test-utils/bootstrap.ts` have targeted overrides in `biome.json`; add an override
there rather than sprinkling ignore comments.

`tsconfig.json` excludes `src/server/services/email-providers/resend.ts` from typechecking —
changes to it are not covered by `bun run check`.

### Naming that isn't inferable

App controllers export a plain name (`home`, `projects`); API controllers use an `Api` suffix
(`examplesApi`, `statsApi`) so both can be barrel-exported when they share a resource name.

## Skills

Detail lives in skills so it loads only when it's relevant:

- `adding-a-feature` — wiring a new page, API endpoint, or admin route through every layer
- `writing-tests` — the testing pattern for each module type
- `verifying-changes` — how to run checks and tests, and what the failures mean

## Runbooks

`runbooks/` holds the operational standards this project is held to — `SECURITY.md`, `PRIVACY.md`,
`ACCESSIBILITY.md`, `SEO.md`, `EMAIL.md`, `CI.md`, `TEAMS.md`. Read the relevant one before
changing headers, cookies, metadata, email delivery, or anything on the team surface.
