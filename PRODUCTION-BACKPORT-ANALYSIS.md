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

### 3. Test coverage enforcement

Both added a `bunfig.toml` with coverage thresholds (95% lines/functions, 80% branches/statements) and reporters (text + lcov). The template has no coverage config at all.

**Files:** `bunfig.toml` (new)

### ~~4. Guest session service + BunRequest cookie API~~ ✅ Done

~~Both added a `getSessionContext()` function that auto-creates guest sessions, separating session concerns from auth concerns. Both use `BunRequest` with its native cookie API instead of manual string parsing. This supports cart/state before login and is a cleaner architecture overall.~~

**Files:** `src/server/services/sessions.ts` (new), `src/server/middleware/auth.ts`

### ~~5. BunRequest test helpers with cookie mocking~~ ✅ Done

~~Both upgraded `createBunRequest()` with full cookie API mocking (`get()`, `set()`, `delete()`), cookie header parsing, and assertion helpers like `getSetCookieHeaders()` and `findSetCookie()`.~~

**Files:** `src/server/test-utils/bun-request.ts`, `src/server/test-utils/setup.ts`

### 6. Install tailwindcss as a dep (not bunx)

Both switched from `bunx @tailwindcss/cli` to running `tailwindcss` as a direct dependency. More reliable, avoids re-downloading on every build.

**Files:** `package.json`

### 7. Admin middleware + route namespace

Both added role-based admin middleware and a third route file (`routes/admin.tsx`). This is a natural extension of the auth system the template already ships.

**Files:** `src/server/middleware/admin.ts` (new), `src/server/routes/admin.tsx` (new), `src/server/main.ts`

### 8. Flash cookie refactor

Both extracted `getFlashCookieOptions()` as a DRY helper for shared cookie config instead of inlining cookie options in multiple places.

**Files:** `src/server/utils/flash.ts`

### 9. User agent utilities

Both added platform detection (iOS, Android, Turbo Native) with CSS class injection into `<body>`, integrated into the `render()` function in `response.ts`.

**Files:** `src/server/utils/user-agent.ts` (new), `src/server/utils/response.ts`

---

## Medium Priority (one project, but clearly generic)

### 10. Environment validation on startup

realfast added `src/server/utils/env.ts` — validates required env vars at startup with helpful error messages. Exits with code 1 if anything is missing. Prevents silent failures in production.

**Files:** `src/server/utils/env.ts` (new), `src/server/main.ts`

### 11. Asset cache-busting service

realfast added `src/server/services/assets.ts` — MD5-hashes JS/CSS filenames in production, serves with `Cache-Control: public, max-age=31536000, immutable`. Essential for production performance and already called out as a gap in README-ANALYSIS.md.

**Files:** `src/server/services/assets.ts` (new), `src/server/main.ts`

### 12. Rate limiting middleware

realfast added `src/server/middleware/rate-limit.ts` — sliding-window in-memory rate limiter with configurable max requests and window. Generic enough for any project with public APIs.

**Files:** `src/server/middleware/rate-limit.ts` (new)

### 13. Migration `create` command

realfast added a `create` command to `src/server/database/cli.ts` that generates timestamped migration files with up/down templates. The template only has `up`, `status`, and `down`.

**Files:** `src/server/database/cli.ts`

### 14. Stricter tsconfig

realfast added `noUnusedLocals` and `noUnusedParameters`. Both added `"include": ["src/**/*"]` for explicit compiler scope.

**Files:** `tsconfig.json`

### 15. Client page lifecycle system

realfast added `src/client/page-lifecycle.ts` — a `registerPage()` / `PageController` interface with `init()` and `cleanup()`. Solves the problem of page-specific JS leaking state across navigations (important if the template ever adopts Turbo or similar).

**Files:** `src/client/page-lifecycle.ts` (new), `src/client/main.ts`

### 16. Biome config updates

realfast added `noUnusedVariables: "error"`, removed nursery rule overrides, and bumped the schema version.

**Files:** `biome.json`

---

## Low Priority (nice-to-have)

### ~~17. Centralized logging~~ ✅ Done (simplified)

~~realfast added `src/server/services/logger.ts` — in-memory log buffer with levels (error/warn/info), structured entries, and `drainLogs()` for batch processing. Paired with `log-scheduler.ts` for hourly email digests. Solves the problem of `no-console` being enforced with no alternative provided.~~

Implemented as a thin stdout/stderr wrapper (no buffering or scheduling). Biome `noConsole` rule now enforced.

**Files:** `src/server/services/logger.ts` (new)

### 18. Database seed script template

Both added `bun run seed` scripts with domain-specific data. The template should include an empty seed scaffold and the npm script.

**Files:** `src/server/database/seed.ts` (new), `package.json`

### 19. Email provider abstraction

mandir added a proper email provider interface with a Resend implementation alongside the existing console provider. The template only has the console provider.

**Files:** `src/server/services/email-providers/resend.ts` (new)

### 20. Text utilities

Both projects ended up needing `toTitleCase()` and `slugToLabel()`. Small but repeatedly useful.

**Files:** `src/server/utils/text.ts` (new)

---

## Skipped (domain-specific)

These were changes made for the specific product, not the framework:

- Extended user model fields (name, address, role, whatsapp)
- Multiple transactional email templates (booking, refund, membership, etc.)
- Stripe/Google Calendar/Mixpanel integrations
- IoT health check polling (realfast vending machines)
- DaisyUI, chart.js, marked, lucide-react dependencies
- CSV export utilities
- Turbo lifecycle management (only relevant if template adopts Turbo)
- Domain-specific config directories (`src/server/config/`)
