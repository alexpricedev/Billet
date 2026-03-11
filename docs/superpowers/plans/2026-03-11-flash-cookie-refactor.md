# Flash Cookie Refactor Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract `getFlashCookieOptions()` as a DRY helper and add a typed `stateHelpers<T>()` factory for cleaner controller flash state usage.

**Architecture:** Pure refactor of `flash.ts` to extract cookie options, plus new `state.ts` utility that wraps flash cookies with a typed API.

**Tech Stack:** Bun, TypeScript

---

## Chunk 1: Flash Cookie Refactor + State Helpers

### Task 1: Extract getFlashCookieOptions in flash.ts

**Files:**
- Modify: `src/server/utils/flash.ts`

- [ ] **Step 1: Extract the cookie options into a named function**

In `src/server/utils/flash.ts`, add a `FlashCookieOptions` interface and `getFlashCookieOptions()` function, then use it in `setFlashCookie`:

Replace the inline options object in `setFlashCookie` with a call to `getFlashCookieOptions()`:

```typescript
import type { BunRequest } from "bun";
import { computeHMAC } from "./crypto";

const FLASH_COOKIE_PREFIX = "flash_";
const FLASH_COOKIE_MAX_AGE = 300; // 5 minutes

interface FlashCookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax" | "strict" | "none";
  path: string;
  maxAge: number;
}

const getFlashCookieOptions = (): FlashCookieOptions => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: FLASH_COOKIE_MAX_AGE,
});

export const setFlashCookie = <T>(
  req: BunRequest,
  key: string,
  data: T,
): void => {
  const cookieName = `${FLASH_COOKIE_PREFIX}${key}`;
  const payload = JSON.stringify(data);
  const signature = computeHMAC(payload);
  const signedValue = `${signature}.${payload}`;

  req.cookies.set(cookieName, signedValue, getFlashCookieOptions());
};
```

Leave `getFlashCookie` unchanged.

- [ ] **Step 2: Run existing tests**

Run: `bun run test`
Expected: All tests pass (pure refactor, no behavior change).

- [ ] **Step 3: Run lint and typecheck**

Run: `bun run check`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/server/utils/flash.ts
git commit -m "refactor: extract getFlashCookieOptions helper in flash.ts"
```

---

### Task 2: Add state helpers factory with tests (TDD)

**Files:**
- Create: `src/server/utils/state.ts`
- Create: `src/server/utils/state.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/server/utils/state.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { createBunRequest, getSetCookieHeaders } from "../test-utils/bun-request";
import { stateHelpers } from "./state";

interface TestState {
  success?: boolean;
  error?: string;
}

describe("State Helpers", () => {
  const helpers = stateHelpers<TestState>();

  test("sets and gets flash state", () => {
    const req = createBunRequest("http://localhost:3000/test");

    helpers.setFlash(req, { success: true });

    const setCookies = getSetCookieHeaders(req);
    expect(setCookies.length).toBeGreaterThan(0);
    expect(setCookies[0]).toContain("flash_state=");

    const result = helpers.getFlash(req);
    expect(result.success).toBe(true);
  });

  test("deletes flash cookie after reading", () => {
    const req = createBunRequest("http://localhost:3000/test");

    helpers.setFlash(req, { success: true });

    const firstRead = helpers.getFlash(req);
    expect(firstRead.success).toBe(true);

    const deleteCookies = getSetCookieHeaders(req);
    const hasDeletion = deleteCookies.some(
      (cookie) =>
        cookie.includes("flash_state=") && cookie.includes("Max-Age=0"),
    );
    expect(hasDeletion).toBe(true);

    const secondRead = helpers.getFlash(req);
    expect(secondRead).toEqual({});
  });

  test("returns empty object for missing flash cookie", () => {
    const req = createBunRequest("http://localhost:3000/test");

    const result = helpers.getFlash(req);
    expect(result).toEqual({});
  });

  test("rejects cookie with tampered signature", () => {
    const req = createBunRequest("http://localhost:3000/test");

    helpers.setFlash(req, { success: true });

    const setCookies = getSetCookieHeaders(req);
    const cookieValue = setCookies[0]?.match(/flash_state=([^;]+)/)?.[1];

    if (cookieValue) {
      const parts = cookieValue.split(".");
      const tamperedValue = `badsignature.${parts.slice(1).join(".")}`;

      const req2 = createBunRequest("http://localhost:3000/test", {
        headers: {
          cookie: `flash_state=${tamperedValue}`,
        },
      });

      const result = helpers.getFlash(req2);
      expect(result).toEqual({});
    }
  });

  test("sets correct cookie attributes", () => {
    const req = createBunRequest("http://localhost:3000/test");

    helpers.setFlash(req, { success: true });

    const setCookies = getSetCookieHeaders(req);
    const cookieString = setCookies[0];

    expect(cookieString).toContain("HttpOnly");
    expect(cookieString).toContain("Path=/");
    expect(cookieString).toContain("Max-Age=300");
    expect(cookieString).toContain("SameSite=Lax");
  });

  test("handles complex state objects", () => {
    const req = createBunRequest("http://localhost:3000/test");

    helpers.setFlash(req, { success: true, error: "Something failed" });

    const result = helpers.getFlash(req);
    expect(result.success).toBe(true);
    expect(result.error).toBe("Something failed");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test:file src/server/utils/state.test.ts`
Expected: FAIL — `stateHelpers` does not exist yet.

- [ ] **Step 3: Write the state helpers**

Create `src/server/utils/state.ts`:

```typescript
import type { BunRequest } from "bun";
import { getFlashCookie, setFlashCookie } from "./flash";

export const stateHelpers = <T>() => ({
  getFlash: (req: BunRequest): T => {
    return getFlashCookie<T>(req, "state");
  },

  setFlash: (req: BunRequest, state: T): void => {
    setFlashCookie<T>(req, "state", state);
  },
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test:file src/server/utils/state.test.ts`
Expected: All 6 tests PASS.

- [ ] **Step 5: Run full test suite**

Run: `bun run test`
Expected: All tests pass.

- [ ] **Step 6: Run lint and typecheck**

Run: `bun run check`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/server/utils/state.ts src/server/utils/state.test.ts
git commit -m "feat: add stateHelpers factory for typed flash state"
```

---

### Task 3: Update PRODUCTION-BACKPORT-ANALYSIS.md and memory

**Files:**
- Modify: `PRODUCTION-BACKPORT-ANALYSIS.md:51-55` (mark item 8 done)
- Modify: `/Users/alexprice/.claude/projects/-Users-alexprice-projects-SpeedLoaf/memory/MEMORY.md` (update completed items)

- [ ] **Step 1: Mark item 8 as done in backport analysis**

In `PRODUCTION-BACKPORT-ANALYSIS.md`, update item 8:
- Add `~~` strikethrough around the title and description
- Add `✅ Done` to the heading

- [ ] **Step 2: Update memory file**

Update the "Completed Backport Items" line to include item 8.

- [ ] **Step 3: Commit**

```bash
git add PRODUCTION-BACKPORT-ANALYSIS.md
git commit -m "docs: mark backport item #8 (flash cookie refactor) as done"
```
