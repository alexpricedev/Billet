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
bun run test     # migrations, then every *.test.ts / *.test.tsx file
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
3. Kills any file that exceeds 60s (`TEST_FILE_TIMEOUT_MS`) and reports it as failed rather than
   hanging the run.

The environment is not the runner's job. `bunfig.toml` preloads `src/server/test-utils/test-env.ts`
into every test file, which pins `SESSION_COOKIE_NAME`, the three feature flags, `APP_URL`/`PORT`
and the rest — so your `.env` can't reach a test run whichever command started it.

## Reading failures

- **`DATABASE_URL is required for tests`** — `.env.test` is missing or unloaded. It holds one key,
  `DATABASE_URL`, and it needs a separate database from development; see `START_PROMPT.md` §1.
- **A file reported as `TIMED OUT`** — usually an unclosed SQL connection. Service tests need
  `await connection.end()` in `afterAll`.
- **Auth or session assertions failing across many files** — no longer your `.env`; the preload
  pins those. Check that `test-env.ts` is still first in `bunfig.toml`'s `preload`, and that you
  ran the script rather than `bun test` against a stale schema.
- **Type errors in `email-providers/resend.ts`** — that file is excluded in `tsconfig.json`, so
  `bun run check` will not catch regressions there.

## Browser checks

For user-visible changes, confirm in the browser with the `/browse` skill against
http://localhost:3000. The dev server is already running in another tab — don't start one.
