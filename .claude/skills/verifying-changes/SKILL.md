---
name: verifying-changes
description: How to lint, typecheck, and test this repo before finishing work. Use when you have edited files under src/ and need to confirm the change is sound, when a test or lint command is behaving unexpectedly, or when deciding which command to run for a targeted check.
---

# Verifying changes

Run these through the `package.json` scripts. They set env vars and apply migrations that the
raw `bun` commands do not.

## The two commands

```bash
bun run check    # biome lint + tsc --noEmit
bun run test     # migrations, then every *.test.ts file
```

`bun run check` is fast and should pass before you consider a change done. `bun run test` is the
behavioural gate. The pre-commit hook runs `bun run build && bun run check`, so a lint or type
error blocks the commit.

## Targeted runs

```bash
bun run test:file src/server/services/project.test.ts   # one file, migrations first
bun run lint:write                                       # apply Biome's safe fixes
bun run typecheck                                        # types only
```

`bun run test:file` takes a path or a directory. Prefer it over `bun test <file>` while iterating.

## Why not `bun test` directly

`bun run test` executes `src/server/test-utils/run-tests.ts`, which:

1. Applies migrations against the test database first — `bun test` alone runs against whatever
   schema happens to be there.
2. Spawns one process per test file, so a module mock or a mutated global in one file can't leak
   into the next.
3. Pins `SESSION_COOKIE_NAME=session_id`. Tests hardcode that cookie name; a custom value in your
   `.env` otherwise leaks in and fails auth tests for reasons that look unrelated.
4. Kills any file that exceeds 60s (`TEST_FILE_TIMEOUT_MS`) and reports it as failed rather than
   hanging the run.

## Reading failures

- **`DATABASE_URL is required for tests`** — `.env.test` is missing or unloaded. It needs a
  separate database from development; see `START_PROMPT.md` §1.
- **A file reported as `TIMED OUT`** — usually an unclosed SQL connection. Service tests need
  `await connection.end()` in `afterAll`.
- **Auth or session assertions failing across many files** — check for `SESSION_COOKIE_NAME` in
  your `.env`, and that you ran the script rather than `bun test`.
- **Type errors in `email-providers/resend.ts`** — that file is excluded in `tsconfig.json`, so
  `bun run check` will not catch regressions there.

## Browser checks

For user-visible changes, confirm in the browser with the `/browse` skill against
http://localhost:3000. The dev server is already running in another tab — don't start one.
