# Auto-migrations & Logger — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add auto-migrations on server startup and a minimal logger service to replace raw console.* calls.

**Architecture:** A thin `log` object wraps `console.*` in one file (the only place raw console is allowed). `runMigrations()` is called before `Bun.serve()` so pending migrations run on every deploy. Biome's `noConsole` rule is enabled to enforce the pattern going forward.

**Tech Stack:** Bun, TypeScript, Biome, PostgreSQL

**Spec:** `docs/superpowers/specs/2026-03-11-auto-migrations-and-logger-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/server/services/logger.ts` | Thin console wrapper: `log.info`, `log.warn`, `log.error` |
| Create | `src/server/services/logger.test.ts` | Unit tests for logger |
| Modify | `src/server/database/migrate.ts` | Replace `console.log` → `log.info` |
| Modify | `src/server/main.ts` | Add auto-migrations + replace `console.log` → `log.info` |
| Modify | `src/server/services/database.ts` | Replace `console.error` → `log.error` |
| Modify | `src/server/middleware/csrf.ts` | Replace `console.error` → `log.error` |
| Modify | `src/server/services/email-providers/console.ts` | Replace `console.log` → `log.info` |
| Modify | `src/server/services/email.test.ts` | Update ConsoleLogProvider test assertions |
| Modify | `biome.json` | Enable `noConsole` rule + CLI file overrides |

---

## Task 1: Create logger service (TDD)

**Files:**
- Create: `src/server/services/logger.test.ts`
- Create: `src/server/services/logger.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { log } from "./logger";

describe("log", () => {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  let logCalls: string[];
  let warnCalls: string[];
  let errorCalls: string[];

  beforeEach(() => {
    logCalls = [];
    warnCalls = [];
    errorCalls = [];
    console.log = (...args: unknown[]) => logCalls.push(args.join(" "));
    console.warn = (...args: unknown[]) => warnCalls.push(args.join(" "));
    console.error = (...args: unknown[]) => errorCalls.push(args.join(" "));
  });

  afterEach(() => {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  });

  test("info writes to stdout with formatted prefix", () => {
    log.info("server", "Listening on :3000");
    expect(logCalls).toHaveLength(1);
    expect(logCalls[0]).toBe("[INFO] [server] Listening on :3000");
  });

  test("warn writes to stderr with formatted prefix", () => {
    log.warn("auth", "Token expiring soon");
    expect(warnCalls).toHaveLength(1);
    expect(warnCalls[0]).toBe("[WARN] [auth] Token expiring soon");
  });

  test("error writes to stderr with formatted prefix", () => {
    log.error("database", "Connection failed");
    expect(errorCalls).toHaveLength(1);
    expect(errorCalls[0]).toBe("[ERROR] [database] Connection failed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test:file src/server/services/logger.test.ts`
Expected: FAIL — `./logger` module not found

- [ ] **Step 3: Write the logger implementation**

```ts
// biome-ignore-all lint/suspicious/noConsole: this is the single logging abstraction for the server

export const log = {
  info(category: string, message: string): void {
    console.log(`[INFO] [${category}] ${message}`);
  },

  warn(category: string, message: string): void {
    console.warn(`[WARN] [${category}] ${message}`);
  },

  error(category: string, message: string): void {
    console.error(`[ERROR] [${category}] ${message}`);
  },
};
```

Note: `biome-ignore-all` suppresses the rule for the entire file (Biome 2.x feature). Check this works with the project's Biome version — if not, use per-line `// biome-ignore lint/suspicious/noConsole:` comments on each console call.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test:file src/server/services/logger.test.ts`
Expected: 3 tests PASS

- [ ] **Step 5: Run full check**

Run: `bun run check`
Expected: PASS (no lint or type errors)

- [ ] **Step 6: Commit**

```bash
git add src/server/services/logger.ts src/server/services/logger.test.ts
git commit -m "feat: add logger service"
```

---

## Task 2: Replace console.* in migrate.ts

**Files:**
- Modify: `src/server/database/migrate.ts`

- [ ] **Step 1: Replace all console.log calls with log.info**

Add import at top:
```ts
import { log } from "../services/logger";
```

Replace these lines:

| Line | Before | After |
|------|--------|-------|
| 90 | `console.log(\`Applied migration: ${filename}\`)` | `log.info("migrations", \`Applied: ${filename}\`)` |
| 100 | `console.log("No pending migrations")` | `log.info("migrations", "No pending migrations")` |
| 104 | `console.log(\`Running ${pendingMigrations.length} pending migrations...\`)` | `log.info("migrations", \`Running ${pendingMigrations.length} pending migrations...\`)` |
| 110 | `console.log("All migrations completed")` | `log.info("migrations", "All migrations completed")` |
| 133 | `console.log(\`Rolled back migration: ${filename}\`)` | `log.info("migrations", \`Rolled back: ${filename}\`)` |
| 143 | `console.log("No migrations to rollback")` | `log.info("migrations", "No migrations to rollback")` |

- [ ] **Step 2: Run check**

Run: `bun run check`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/server/database/migrate.ts
git commit -m "refactor: use logger in migration runner"
```

---

## Task 3: Add auto-migrations to main.ts

**Files:**
- Modify: `src/server/main.ts`

- [ ] **Step 1: Add imports and auto-migration call**

Add before `Bun.serve()`:
```ts
import { log } from "./services/logger";
import { runMigrations } from "./database/migrate";

await runMigrations();
```

- [ ] **Step 2: Replace console.log with logger**

Replace line 31:
```ts
// Before
console.log(`Server running at http://localhost:${server.port}`);

// After
log.info("server", `Listening on port ${server.port}`);
```

- [ ] **Step 3: Run check**

Run: `bun run check`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/server/main.ts
git commit -m "feat: auto-run migrations on server startup"
```

---

## Task 4: Replace console.* in remaining server files

**Files:**
- Modify: `src/server/services/database.ts`
- Modify: `src/server/middleware/csrf.ts`
- Modify: `src/server/services/email-providers/console.ts`
- Modify: `src/server/services/email.test.ts`

- [ ] **Step 1: Update database.ts**

Add import:
```ts
import { log } from "./logger";
```

Replace line 15:
```ts
// Before
console.error("Database connection failed:", error);

// After
log.error("database", `Connection failed: ${error instanceof Error ? error.message : String(error)}`);
```

- [ ] **Step 2: Update csrf.ts**

Add import:
```ts
import { log } from "../services/logger";
```

Replace lines 28-30:
```ts
// Before
console.error(
  `CSRF middleware: method mismatch - expected ${expectedMethod}, got ${actualMethod}`,
);

// After
log.error(
  "csrf",
  `Method mismatch - expected ${expectedMethod}, got ${actualMethod}`,
);
```

- [ ] **Step 3: Update email-providers/console.ts**

Add import:
```ts
import { log } from "../logger";
```

Replace line 22:
```ts
// Before
console.log(output);

// After
log.info("email", output);
```

- [ ] **Step 4: Update email.test.ts**

The ConsoleLogProvider test spies on `console.log`. After the change, `log.info("email", output)` calls `console.log("[INFO] [email] " + output)` under the hood. The spy still captures it, but the format changes.

Update the assertions (around line 201-206):

```ts
expect(logCalls).toHaveLength(1);
const output = logCalls[0];
expect(output).toContain("[INFO] [email]");
expect(output).toContain("📧 EMAIL SEND");
expect(output).toContain("Test User <test@example.com>");
expect(output).toContain("From User <from@example.com>");
expect(output).toContain("Test Subject");
expect(output).toContain("<p>Test HTML</p>");
expect(output).toContain("Test text");
```

- [ ] **Step 5: Run tests for affected files**

Run: `bun run test:file src/server/services/email.test.ts`
Expected: PASS

- [ ] **Step 6: Run full check**

Run: `bun run check`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/server/services/database.ts src/server/middleware/csrf.ts src/server/services/email-providers/console.ts src/server/services/email.test.ts
git commit -m "refactor: replace console.* with logger across server code"
```

---

## Task 5: Enable Biome noConsole rule

**Files:**
- Modify: `biome.json`

- [ ] **Step 1: Add noConsole rule + CLI script overrides**

Add a new `"suspicious"` key as a sibling to `"style"` and `"nursery"` under `linter.rules` in `biome.json`:

```json
"suspicious": {
  "noConsole": "error"
}
```

Add override entries for CLI scripts (these are standalone terminal tools):

```json
{
  "includes": ["src/server/database/cli.ts", "src/server/test-utils/bootstrap.ts"],
  "linter": {
    "rules": {
      "suspicious": {
        "noConsole": "off"
      }
    }
  }
}
```

And for test files (tests often spy on/use console):

```json
{
  "includes": ["**/*.test.ts"],
  "linter": {
    "rules": {
      "suspicious": {
        "noExplicitAny": "off",
        "noConsole": "off"
      }
    }
  }
}
```

Note: merge the test file override with the existing `**/*.test.ts` override — don't create a duplicate.

- [ ] **Step 2: Verify logger.ts suppression works**

The `logger.ts` file needs a Biome suppression comment. Verify the `biome-ignore-all` comment added in Task 1 is recognized. If not, switch to per-line `// biome-ignore lint/suspicious/noConsole:` comments.

- [ ] **Step 3: Run lint**

Run: `bun run check`
Expected: PASS — no console violations (logger has suppression, CLI scripts have override, test files have override, all other files use logger)

- [ ] **Step 4: Commit**

```bash
git add biome.json
git commit -m "chore: enable Biome noConsole rule with CLI/test overrides"
```

---

## Task 6: Final verification

- [ ] **Step 1: Run full test suite**

Run: `bun run test`
Expected: All tests PASS

- [ ] **Step 2: Run full lint + typecheck**

Run: `bun run check`
Expected: PASS

- [ ] **Step 3: Grep for remaining console.* in server code (excluding overridden files)**

Run: Search for `console\.` in `src/server/` excluding `cli.ts`, `bootstrap.ts`, `logger.ts`, and `*.test.ts`.

Expected: Zero matches (only logger.ts, CLI scripts, and test files should have console calls)
