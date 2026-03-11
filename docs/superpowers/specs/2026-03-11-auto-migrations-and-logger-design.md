# Auto-migrations & Logger Service — Design Spec

**Date:** 2026-03-11
**Backport items:** #1 (Auto-migrations on startup), #17 (Centralized logging)
**Source:** PRODUCTION-BACKPORT-ANALYSIS.md

---

## Motivation

Two pain points from production projects converge here:

1. The template relies on Railway's start command to run migrations. Baking `runMigrations()` into the server entry point is more portable and works regardless of deployment platform.
2. The `no-console` ESLint rule is enforced but no alternative is provided. Every server file that needs to log something either suppresses the rule inline or doesn't log at all.

A minimal logger solves problem 2 and gives auto-migrations (problem 1) somewhere to write output.

---

## Logger Service

**New file:** `src/server/services/logger.ts`

A thin abstraction over `console.*` that satisfies the `no-console` rule while writing to stdout/stderr for platform log capture (Railway, etc.).

### API

```ts
export const log = {
  info(category: string, message: string): void,
  warn(category: string, message: string): void,
  error(category: string, message: string): void,
};
```

### Output format

```
[LEVEL] [category] message
```

Examples:

```
[INFO] [migrations] Running 2 pending migrations...
[INFO] [server] Listening on :3000
[ERROR] [csrf] Session missing CSRF secret: abc123
```

### Implementation notes

- `info` writes to stdout via `console.log`
- `warn` writes to stderr via `console.warn`
- `error` writes to stderr via `console.error`
- A single `/* eslint-disable no-console */` at the top of the file; this is the one place in the server where raw console access is allowed

---

## Auto-migrations on Startup

**Update:** `src/server/main.ts`

Add `await runMigrations()` before `Bun.serve()`. If a migration fails, the error propagates and the server doesn't start -- fail-safe by design. This is the pattern both realfast and sheffield-hindu-mandir use in production.

```ts
import { runMigrations } from "./database/migrate";

await runMigrations();

Bun.serve({ ... });
```

Migration output goes through the logger:

```
[INFO] [migrations] Running 2 pending migrations...
[INFO] [migrations] Applied 001_initial_setup
[INFO] [migrations] Applied 002_add_sessions
[INFO] [migrations] All migrations complete
```

---

## Console.log Cleanup

### Server runtime files -- replace with logger

| File | Before | After |
|------|--------|-------|
| `src/server/main.ts` | `console.log` | `log.info("server", ...)` |
| `src/server/database/migrate.ts` | `console.log` | `log.info("migrations", ...)` |
| `src/server/services/database.ts` | `console.error` | `log.error("database", ...)` |
| `src/server/middleware/csrf.ts` | `console.error` | `log.error("csrf", ...)` |
| `src/server/services/email-providers/console.ts` | `console.log` | `log.info("email", ...)` |

### CLI scripts -- add eslint-disable

These are standalone terminal tools, not server code. Raw console is appropriate.

| File | Change |
|------|--------|
| `src/server/database/cli.ts` | Add file-level `/* eslint-disable no-console */` |
| `src/server/test-utils/bootstrap.ts` | Add file-level `/* eslint-disable no-console */` |

---

## Testing

- **Logger unit test** (`src/server/services/logger.test.ts`) -- spy on `console.log` / `console.warn` / `console.error`, call each method, assert output format
- **Update existing tests** if they assert on console output (check migration and CSRF test files)

---

## Out of Scope

- In-memory log buffering
- Log scheduling / email digests (realfast's `log-scheduler.ts`)
- Structured JSON logging
- Log levels beyond info/warn/error
