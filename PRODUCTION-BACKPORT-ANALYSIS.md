# Production Backport Analysis

Changes made in **realfast** and **sheffield-hindu-mandir** that should come back into the SpeedLoaf template.

---

## High Priority (appeared in both projects)

### ~~1. Auto-migrations on startup~~ ✅ Done

~~Both projects added `await runMigrations()` in `main.ts` before `Bun.serve()`. The template currently relies on Railway's start command to run migrations, but baking it into the server entry point is more portable and works regardless of deployment platform.~~

**Files:** `src/server/main.ts`

### ~~2. Synchronous rendering~~ ✅ Done

~~Both switched `src/server/utils/response.ts` from `renderToReadableStream()` to `renderToString()`. Streaming is unnecessary for server-rendered pages at this scale and the synchronous model is simpler to reason about. (Note: this contradicts a fix logged in README-ANALYSIS.md where we switched _to_ streaming — a decision was clearly reversed in practice.)~~

**Files:** `src/server/utils/response.ts`

### ~~3. Test coverage enforcement~~ ✅ Done

~~Both added a `bunfig.toml` with coverage thresholds (95% lines/functions, 80% branches/statements) and reporters (text + lcov). The template has no coverage config at all.~~

**Files:** `bunfig.toml`

### ~~4. Guest session service + BunRequest cookie API~~ ✅ Done

~~Both added a `getSessionContext()` function that auto-creates guest sessions, separating session concerns from auth concerns. Both use `BunRequest` with its native cookie API instead of manual string parsing. This supports cart/state before login and is a cleaner architecture overall.~~

**Files:** `src/server/services/sessions.ts` (new), `src/server/middleware/auth.ts`

### ~~5. BunRequest test helpers with cookie mocking~~ ✅ Done

~~Both upgraded `createBunRequest()` with full cookie API mocking (`get()`, `set()`, `delete()`), cookie header parsing, and assertion helpers like `getSetCookieHeaders()` and `findSetCookie()`.~~

**Files:** `src/server/test-utils/bun-request.ts`, `src/server/test-utils/setup.ts`

### ~~6. Install tailwindcss as a dep (not bunx)~~ ✅ Done

~~Both switched from `bunx @tailwindcss/cli` to running `tailwindcss` as a direct dependency. More reliable, avoids re-downloading on every build.~~

**Files:** `package.json`

### ~~7. Admin middleware + route namespace~~ ✅ Done

~~Both added role-based admin middleware and a third route file (`routes/admin.tsx`). This is a natural extension of the auth system the template already ships.~~

**Files:** `src/server/middleware/admin.ts` (new), `src/server/routes/admin.tsx` (new), `src/server/main.ts`

### ~~8. Flash cookie refactor~~ ✅ Done

~~Both extracted `getFlashCookieOptions()` as a DRY helper for shared cookie config instead of inlining cookie options in multiple places.~~

**Files:** `src/server/utils/flash.ts`

### ~~9. User agent utilities~~ — Skipped

~~Both added platform detection (iOS, Android, Turbo Native) with CSS class injection into `<body>`, integrated into the `render()` function in `response.ts`.~~

Skipped — the implementations detect iOS/Android/Turbo Native platforms, which is domain-specific. Mobile vs desktop detection is better handled by CSS media queries (already available via Tailwind).

**Files:** `src/server/utils/user-agent.ts` (new), `src/server/utils/response.ts`

---

## Medium Priority (one project, but clearly generic)

### ~~10. Environment validation on startup~~ ✅ Done

~~realfast added `src/server/utils/env.ts` — validates required env vars at startup with helpful error messages. Exits with code 1 if anything is missing. Prevents silent failures in production.~~

**Files:** `src/server/utils/env.ts` (new), `src/server/main.ts`

### ~~11. Asset cache-busting service~~ ✅ Done

~~realfast added `src/server/services/assets.ts` — MD5-hashes JS/CSS filenames in production, serves with `Cache-Control: public, max-age=31536000, immutable`. Essential for production performance and already called out as a gap in README-ANALYSIS.md.~~

**Files:** `src/server/services/assets.ts` (new), `src/server/main.ts`

### ~~12. Rate limiting middleware~~ ✅ Done

~~realfast added `src/server/middleware/rate-limit.ts` — sliding-window in-memory rate limiter with configurable max requests and window. Generic enough for any project with public APIs.~~

**Files:** `src/server/middleware/rate-limit.ts` (new)

### ~~13. Stricter tsconfig~~ ✅ Done

~~realfast added `noUnusedLocals` and `noUnusedParameters`. Both added `"include": ["src/**/*"]` for explicit compiler scope.~~

**Files:** `tsconfig.json`

### ~~14. Client page lifecycle system~~ ✅ Done

~~realfast added `src/client/page-lifecycle.ts` — a `registerPage()` / `PageController` interface with `init()` and `cleanup()`. Solves the problem of page-specific JS leaking state across navigations (important if the template ever adopts Turbo or similar).~~

**Files:** `src/client/page-lifecycle.ts` (new), `src/client/main.ts`

### ~~15. Biome config updates~~ ✅ Done

~~realfast added `noUnusedVariables: "error"`. Nursery overrides kept (needed for server-rendered JSX with static IDs).~~

**Files:** `biome.json`

---

## Low Priority (nice-to-have)

### ~~17. Centralized logging~~ ✅ Done (simplified)

~~realfast added `src/server/services/logger.ts` — in-memory log buffer with levels (error/warn/info), structured entries, and `drainLogs()` for batch processing. Paired with `log-scheduler.ts` for hourly email digests. Solves the problem of `no-console` being enforced with no alternative provided.~~

Implemented as a thin stdout/stderr wrapper (no buffering or scheduling). Biome `noConsole` rule now enforced.

**Files:** `src/server/services/logger.ts` (new)

### ~~18. Database seed script template~~ ✅ Done

~~Both added `bun run seed` scripts with domain-specific data. The template should include an empty seed scaffold and the npm script.~~

**Files:** `src/server/database/seed.ts` (new), `package.json`

### ~~19. Email provider abstraction~~ ✅ Done

~~mandir added a proper email provider interface with a Resend implementation alongside the existing console provider. The template only has the console provider.~~

Implemented with pluggable `registerEmailProvider()` API. Resend provider included as a reference implementation (requires `bun add resend` to use). Users can register any custom provider via the `EmailProvider` interface.

**Files:** `src/server/services/email.ts`, `src/server/services/email-providers/resend.ts` (new)
