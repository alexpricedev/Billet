# Changelog

Billet is consumed by cloning or forking this repository, not by installing from npm. Tags and
this file are the only upgrade signals a fork gets, so anything that can silently break a fork
after a merge is documented here under **Breaking changes**.

Versions follow [semantic versioning](https://semver.org/): a major bump means a fork needs to
change its own code after merging.

## Unreleased

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
  the fields the form submits.
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
- The layered bot defence (rate limit → honeypot → captcha) moved out of the login controller
  into `controllers/auth/form-guard.ts` and now runs on `/signup` and `/forgot-password` too.
  A honeypot or captcha failure hands the parsed body back to the caller, so `/reset-password`
  can re-render behind the token the visitor already has instead of sending them off to request
  a new email over a stale challenge.
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
