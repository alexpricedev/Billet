# Changelog

Billet is consumed by cloning or forking this repository, not by installing from npm. Tags and
this file are the only upgrade signals a fork gets, so anything that can silently break a fork
after a merge is documented here under **Breaking changes**.

Versions follow [semantic versioning](https://semver.org/): a major bump means a fork needs to
change its own code after merging.

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
