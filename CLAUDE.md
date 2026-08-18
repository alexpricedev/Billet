# CLAUDE.md

Billet is a server-rendered full-stack TypeScript app on Bun + PostgreSQL. Requests flow
route → controller → service → template. `README.md` has the directory tree; the code is the
spec for everything else. This file is for the things you can't learn by reading the repo.

## Working agreements

- The dev server is already running on port 3000 in another tab — don't start one, and don't
  add a second. `bun run dev` here will fail on the port or fight the watcher.
- Run test and lint suites through the `package.json` scripts (`bun run test`, `bun run check`).
  Invoking `bun test` directly skips migrations and leaks your `.env` into the run — see the
  `verifying-changes` skill.
- Write code that reads like the surrounding code: match its comment density, naming, and idiom.
- When you try several approaches to a problem, delete the ones you abandoned before you finish.
- Check work in the browser with the `/browse` skill when the change is user-visible.

## Gotchas

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

`bun run test` runs `src/server/test-utils/run-tests.ts`, which applies migrations first, spawns
one process per test file (isolation + a per-file timeout), and pins `SESSION_COOKIE_NAME=session_id`,
`AUTH_MODE=magic-link`, `CAPTCHA_ENABLED=false`, and `ORGANISATIONS_ENABLED=false`. Tests hardcode
that cookie and assume the default auth mode with the captcha off and organisations off; any of the
four set in your `.env` would otherwise leak in and break every auth test — running the dev server
in password mode, with the captcha on, or with organisations on is enough to do it. Files that
exercise those modes set the variable themselves per-case.

`bunfig.toml` preloads `src/client/test-utils/setup.ts` for *every* test file. It registers
happy-dom globals and then restores Bun's native `Request`/`Response`/`FormData` — server tests
depend on that restore.

### Auth is one mode or the other, never both

`AUTH_MODE` (`src/server/services/auth-mode.ts`) is `magic-link` (default) or `password`. The two
are mutually exclusive on purpose. `/forgot-password`, `/reset-password`, `/account/password`,
and `/auth/verify*` all `render404()` from inside their controllers when the mode is wrong — the
route table in `routes/app.tsx` is static, so a route existing tells you nothing about whether it
answers. `/login`, `/signup`, and `/account` exist in both modes and branch on
`passwordAuthEnabled()`.

`authMode()` reads `process.env` on every call so tests can flip it mid-file; an invalid value is
fatal at boot in `validateEnv()`.

### Organisations change who is allowed to create a user

`ORGANISATIONS_ENABLED` (`src/server/services/organisations-mode.ts`) is off by default and
follows the `AUTH_MODE` pattern: lazy `process.env` read, fatal on a typo, `render404()` from
inside `/organisation*` and `/invites/accept` controllers when it's off.

The part that isn't inferable: **with the flag on, `/signup` is the only path that creates a
user.** In magic-link mode `/login` normally creates one for any unknown address —
`createMagicLink` → `findOrCreateUser` (`services/auth.ts`) — and that form has no organisation
name to put on one, so `login.tsx` looks the address up instead and flashes `no-account`. This
is a knowing trade for account enumeration; don't "fix" it back to a silent no-op, which strands
a real user waiting for mail that was never sent.

Every path that creates a user must create its membership in the *same transaction*
(`signUpWithOrganisation` / `signUpIntoOrganisation`, both using `db.begin` — the only
transactions in the codebase). A user without a membership makes
`assertOrganisationsReady()` refuse to boot, which is also what happens deliberately when the
flag is switched on for a database that already has users. Nothing is ever backfilled.

Invites live in their own table, not `user_tokens`: that table's `user_id` is `NOT NULL`, and an
invite is addressed to an email with no user row yet. Acceptance claims the invite *before*
building the account — a burned invite is recoverable by sending another, an organisation-less
user is not.

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

### Env is validated at boot and `APP_URL` is load-bearing

`validateEnv()` exits the process on a missing var, then migrations run before `Bun.serve()` — a
failed migration means no server. `src/server/services/database.ts` throws at import time without
`DATABASE_URL`, so anything that imports it (directly or not) needs the env set.

`APP_URL` must include the port. CSRF origin validation compares the request `Origin` against it
exactly, so `http://localhost` vs `http://localhost:3000` rejects every form post with a 403.

### Assets are only fingerprinted in production

`initAssets()` and `getAssetUrl()` no-op unless `NODE_ENV=production`, so asset URLs differ between
dev and prod. In production the files must already exist in `dist/assets` or startup throws.

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
`ACCESSIBILITY.md`, `SEO.md`, `EMAIL.md`, `CI.md`. Read the relevant one before changing headers,
cookies, metadata, or email delivery.
