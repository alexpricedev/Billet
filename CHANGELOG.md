# Changelog

Billet is consumed by cloning or forking this repository, not by installing from npm. Tags and
this file are the only upgrade signals a fork gets, so anything that can silently break a fork
after a merge is documented here under **Breaking changes**.

Versions follow [semantic versioning](https://semver.org/): a major bump means a fork needs to
change its own code after merging.

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
- `cleanupTestData` truncates the three new tables. A fork that has its own copy needs the lines.

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
