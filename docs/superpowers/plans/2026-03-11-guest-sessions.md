# Guest Sessions & BunRequest Cookie API — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add auto-created guest sessions for all visitors, upgrade to authenticated on login, and switch to BunRequest's native cookie API.

**Architecture:** New sessions service owns session lifecycle (create guest, lookup, upgrade, delete). Auth service keeps magic links and user management but delegates session operations. Middleware replaces `getAuthContext(Request)` with `getSessionContext(BunRequest)`. All controllers switch to the new API.

**Tech Stack:** Bun, TypeScript, PostgreSQL, Biome

**Spec:** `docs/superpowers/specs/2026-03-11-guest-sessions-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/server/database/migrations/003_add_guest_sessions.ts` | Add session_type column, make user_id nullable |
| Create | `src/server/services/sessions.ts` | Session lifecycle: guest creation, lookup, upgrade, delete, cookie helpers |
| Create | `src/server/services/sessions.test.ts` | Sessions service tests (real DB) |
| Modify | `src/server/services/auth.ts` | Remove session CRUD and cookie helpers; update verifyMagicLink |
| Modify | `src/server/services/auth.test.ts` | Update tests for refactored auth service |
| Modify | `src/server/middleware/auth.ts` | Replace getAuthContext with getSessionContext |
| Modify | `src/server/middleware/auth.test.ts` | Update tests for new middleware |
| Modify | `src/server/controllers/auth/callback.tsx` | Use sessions service, pass guest session for upgrade |
| Modify | `src/server/controllers/auth/logout.tsx` | Use sessions service cookie helpers |
| Modify | `src/server/controllers/app/home.tsx` | Switch to getSessionContext |
| Modify | `src/server/controllers/app/examples.tsx` | Switch to getSessionContext |
| Modify | `src/server/controllers/auth/login.tsx` | Switch to getSessionContext |
| Modify | Controller test files | Update mocks for new API |

---

## Task 1: Database migration

**Files:**
- Create: `src/server/database/migrations/003_add_guest_sessions.ts`

- [ ] **Step 1: Create the migration file**

```ts
import type { SQL } from "bun";

export const up = async (db: SQL): Promise<void> => {
  await db`
    ALTER TABLE sessions
    ADD COLUMN session_type VARCHAR(20) NOT NULL DEFAULT 'authenticated'
  `;
  await db`
    ALTER TABLE sessions
    ALTER COLUMN user_id DROP NOT NULL
  `;
  await db`
    CREATE INDEX idx_sessions_session_type ON sessions(session_type)
  `;
};

export const down = async (db: SQL): Promise<void> => {
  await db`DELETE FROM sessions WHERE session_type = 'guest'`;
  await db`ALTER TABLE sessions ALTER COLUMN user_id SET NOT NULL`;
  await db`DROP INDEX IF EXISTS idx_sessions_session_type`;
  await db`ALTER TABLE sessions DROP COLUMN session_type`;
};
```

- [ ] **Step 2: Run the migration on test DB**

Run: `NODE_ENV=test bun run src/server/database/cli.ts up`
Expected: Applied migration message

- [ ] **Step 3: Run existing tests to verify nothing breaks**

Run: `bun run test`
Expected: All 196+ tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/server/database/migrations/003_add_guest_sessions.ts
git commit -m "feat: add guest sessions migration (session_type + nullable user_id)"
```

---

## Task 2: Sessions service (TDD)

**Files:**
- Create: `src/server/services/sessions.test.ts`
- Create: `src/server/services/sessions.ts`

- [ ] **Step 1: Write the test file**

```ts
import { SQL } from "bun";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { cleanupTestData } from "../test-utils/helpers";

const connection = new SQL(process.env.DATABASE_URL!);

mock.module("./database", () => ({
  get db() {
    return connection;
  },
}));

const {
  createGuestSession,
  createAuthenticatedSession,
  getSessionContextFromDB,
  convertGuestToAuthenticated,
  deleteSession,
  renewSession,
} = await import("./sessions");

const { findOrCreateUser } = await import("./auth");
const { computeHMAC } = await import("../utils/crypto");

const db = connection;

afterAll(async () => {
  await connection.end();
});

beforeEach(async () => {
  await cleanupTestData(db);
});

describe("createGuestSession", () => {
  test("creates a session with type guest and null user_id", async () => {
    const rawId = await createGuestSession();
    expect(rawId).toBeTruthy();

    const hash = computeHMAC(rawId);
    const rows = await db`SELECT * FROM sessions WHERE id_hash = ${hash}`;
    expect(rows).toHaveLength(1);
    expect(rows[0].session_type).toBe("guest");
    expect(rows[0].user_id).toBeNull();
  });

  test("guest session expires in ~24 hours", async () => {
    const rawId = await createGuestSession();
    const hash = computeHMAC(rawId);
    const rows = await db`SELECT expires_at FROM sessions WHERE id_hash = ${hash}`;
    const expiresAt = new Date(rows[0].expires_at);
    const diff = expiresAt.getTime() - Date.now();
    const hours = diff / (1000 * 60 * 60);
    expect(hours).toBeGreaterThan(23);
    expect(hours).toBeLessThan(25);
  });
});

describe("createAuthenticatedSession", () => {
  test("creates a session with type authenticated and user_id", async () => {
    const user = await findOrCreateUser("test@example.com");
    const rawId = await createAuthenticatedSession(user.id);

    const hash = computeHMAC(rawId);
    const rows = await db`SELECT * FROM sessions WHERE id_hash = ${hash}`;
    expect(rows).toHaveLength(1);
    expect(rows[0].session_type).toBe("authenticated");
    expect(rows[0].user_id).toBe(user.id);
  });

  test("authenticated session expires in ~30 days", async () => {
    const user = await findOrCreateUser("test@example.com");
    const rawId = await createAuthenticatedSession(user.id);
    const hash = computeHMAC(rawId);
    const rows = await db`SELECT expires_at FROM sessions WHERE id_hash = ${hash}`;
    const expiresAt = new Date(rows[0].expires_at);
    const diff = expiresAt.getTime() - Date.now();
    const days = diff / (1000 * 60 * 60 * 24);
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThan(31);
  });
});

describe("getSessionContextFromDB", () => {
  test("returns null for non-existent session", async () => {
    const result = await getSessionContextFromDB("non-existent-id");
    expect(result).toBeNull();
  });

  test("returns guest context for guest session", async () => {
    const rawId = await createGuestSession();
    const ctx = await getSessionContextFromDB(rawId);

    expect(ctx).not.toBeNull();
    expect(ctx!.sessionType).toBe("guest");
    expect(ctx!.isGuest).toBe(true);
    expect(ctx!.isAuthenticated).toBe(false);
    expect(ctx!.user).toBeNull();
    expect(ctx!.sessionId).toBe(rawId);
    expect(ctx!.sessionHash).toBeTruthy();
  });

  test("returns authenticated context with user for authenticated session", async () => {
    const user = await findOrCreateUser("auth@example.com");
    const rawId = await createAuthenticatedSession(user.id);
    const ctx = await getSessionContextFromDB(rawId);

    expect(ctx).not.toBeNull();
    expect(ctx!.sessionType).toBe("authenticated");
    expect(ctx!.isGuest).toBe(false);
    expect(ctx!.isAuthenticated).toBe(true);
    expect(ctx!.user).not.toBeNull();
    expect(ctx!.user!.email).toBe("auth@example.com");
  });

  test("returns null for expired session", async () => {
    const rawId = await createGuestSession();
    const hash = computeHMAC(rawId);
    await db`UPDATE sessions SET expires_at = NOW() - INTERVAL '1 hour' WHERE id_hash = ${hash}`;

    const ctx = await getSessionContextFromDB(rawId);
    expect(ctx).toBeNull();
  });
});

describe("convertGuestToAuthenticated", () => {
  test("converts guest session to authenticated", async () => {
    const rawId = await createGuestSession();
    const hash = computeHMAC(rawId);
    const user = await findOrCreateUser("upgrade@example.com");

    const result = await convertGuestToAuthenticated(hash, user.id);
    expect(result).toBe(true);

    const rows = await db`SELECT * FROM sessions WHERE id_hash = ${hash}`;
    expect(rows[0].session_type).toBe("authenticated");
    expect(rows[0].user_id).toBe(user.id);
  });

  test("extends expiry to 30 days on conversion", async () => {
    const rawId = await createGuestSession();
    const hash = computeHMAC(rawId);
    const user = await findOrCreateUser("upgrade@example.com");

    await convertGuestToAuthenticated(hash, user.id);

    const rows = await db`SELECT expires_at FROM sessions WHERE id_hash = ${hash}`;
    const expiresAt = new Date(rows[0].expires_at);
    const days = (expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    expect(days).toBeGreaterThan(29);
  });

  test("returns false for already-authenticated session", async () => {
    const user = await findOrCreateUser("auth@example.com");
    const rawId = await createAuthenticatedSession(user.id);
    const hash = computeHMAC(rawId);

    const result = await convertGuestToAuthenticated(hash, user.id);
    expect(result).toBe(false);
  });

  test("returns false for expired guest session", async () => {
    const rawId = await createGuestSession();
    const hash = computeHMAC(rawId);
    await db`UPDATE sessions SET expires_at = NOW() - INTERVAL '1 hour' WHERE id_hash = ${hash}`;

    const user = await findOrCreateUser("upgrade@example.com");
    const result = await convertGuestToAuthenticated(hash, user.id);
    expect(result).toBe(false);
  });
});

describe("deleteSession", () => {
  test("deletes an existing session", async () => {
    const rawId = await createGuestSession();
    const result = await deleteSession(rawId);
    expect(result).toBe(true);

    const hash = computeHMAC(rawId);
    const rows = await db`SELECT * FROM sessions WHERE id_hash = ${hash}`;
    expect(rows).toHaveLength(0);
  });

  test("returns false for non-existent session", async () => {
    const result = await deleteSession("non-existent");
    expect(result).toBe(false);
  });
});

describe("renewSession", () => {
  test("updates last_activity_at", async () => {
    const user = await findOrCreateUser("renew@example.com");
    const rawId = await createAuthenticatedSession(user.id);
    const hash = computeHMAC(rawId);

    const before = await db`SELECT last_activity_at FROM sessions WHERE id_hash = ${hash}`;
    await new Promise((r) => setTimeout(r, 50));
    await renewSession(rawId);
    const after = await db`SELECT last_activity_at FROM sessions WHERE id_hash = ${hash}`;

    expect(new Date(after[0].last_activity_at).getTime())
      .toBeGreaterThan(new Date(before[0].last_activity_at).getTime());
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test:file src/server/services/sessions.test.ts`
Expected: FAIL — `./sessions` module not found

- [ ] **Step 3: Write the sessions service**

```ts
import { randomUUID } from "node:crypto";
import type { BunRequest } from "bun";
import type { User } from "./auth";
import { db } from "./database";
import { computeHMAC } from "../utils/crypto";
import {
  type DatabaseMutationResult,
  hasAffectedRows,
} from "../utils/database";

export type SessionType = "guest" | "authenticated";

export interface SessionContext {
  sessionId: string | null;
  sessionHash: string | null;
  sessionType: SessionType | null;
  user: User | null;
  isGuest: boolean;
  isAuthenticated: boolean;
  requiresSetCookie: boolean;
}

const GUEST_EXPIRY_MS = 24 * 60 * 60 * 1000;
const AUTH_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

export const SESSION_COOKIE_NAME = "session_id";
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 30 * 24 * 60 * 60,
};

export const getSessionIdFromRequest = (req: BunRequest): string | null => {
  return req.cookies.get(SESSION_COOKIE_NAME) || null;
};

export const setSessionCookie = (
  req: BunRequest,
  rawSessionId: string,
): void => {
  req.cookies.set(SESSION_COOKIE_NAME, rawSessionId, SESSION_COOKIE_OPTIONS);
};

export const clearSessionCookie = (req: BunRequest): void => {
  req.cookies.delete(SESSION_COOKIE_NAME);
};

export const createGuestSession = async (): Promise<string> => {
  const rawSessionId = randomUUID();
  const sessionIdHash = computeHMAC(rawSessionId);
  const expiresAt = new Date(Date.now() + GUEST_EXPIRY_MS);

  await db`
    INSERT INTO sessions (id_hash, session_type, expires_at)
    VALUES (${sessionIdHash}, 'guest', ${expiresAt.toISOString()})
  `;

  return rawSessionId;
};

export const createAuthenticatedSession = async (
  userId: string,
): Promise<string> => {
  const rawSessionId = randomUUID();
  const sessionIdHash = computeHMAC(rawSessionId);
  const expiresAt = new Date(Date.now() + AUTH_EXPIRY_MS);

  await db`
    INSERT INTO sessions (id_hash, user_id, session_type, expires_at)
    VALUES (${sessionIdHash}, ${userId}, 'authenticated', ${expiresAt.toISOString()})
  `;

  return rawSessionId;
};

export const getSessionContextFromDB = async (
  rawSessionId: string,
): Promise<SessionContext | null> => {
  try {
    const sessionIdHash = computeHMAC(rawSessionId);

    const result = await db`
      SELECT
        s.id_hash, s.user_id, s.session_type,
        s.expires_at, s.last_activity_at, s.created_at,
        u.id as user_id_result, u.email, u.created_at as user_created_at
      FROM sessions s
      LEFT JOIN users u ON s.user_id = u.id
      WHERE s.id_hash = ${sessionIdHash}
        AND s.expires_at > CURRENT_TIMESTAMP
    `;

    if (result.length === 0) return null;

    const data = result[0] as {
      id_hash: string;
      user_id: string | null;
      session_type: string;
      expires_at: string;
      last_activity_at: string;
      created_at: string;
      user_id_result: string | null;
      email: string | null;
      user_created_at: string | null;
    };

    const isAuthenticated =
      data.session_type === "authenticated" && data.user_id_result !== null;
    const user: User | null = isAuthenticated
      ? {
          id: data.user_id_result!,
          email: data.email!,
          created_at: new Date(data.user_created_at!),
        }
      : null;

    return {
      sessionId: rawSessionId,
      sessionHash: data.id_hash,
      sessionType: data.session_type as SessionType,
      user,
      isGuest: data.session_type === "guest",
      isAuthenticated,
      requiresSetCookie: false,
    };
  } catch {
    return null;
  }
};

export const convertGuestToAuthenticated = async (
  sessionHash: string,
  userId: string,
): Promise<boolean> => {
  try {
    const expiresAt = new Date(Date.now() + AUTH_EXPIRY_MS);

    const result = await db`
      UPDATE sessions
      SET user_id = ${userId},
          session_type = 'authenticated',
          expires_at = ${expiresAt.toISOString()}
      WHERE id_hash = ${sessionHash}
        AND session_type = 'guest'
        AND expires_at > CURRENT_TIMESTAMP
    `;

    return hasAffectedRows(result as DatabaseMutationResult);
  } catch {
    return false;
  }
};

export const deleteSession = async (
  rawSessionId: string,
): Promise<boolean> => {
  try {
    const sessionIdHash = computeHMAC(rawSessionId);

    const result = await db`
      DELETE FROM sessions
      WHERE id_hash = ${sessionIdHash}
    `;

    return hasAffectedRows(result as DatabaseMutationResult);
  } catch {
    return false;
  }
};

export const renewSession = async (
  rawSessionId: string,
): Promise<boolean> => {
  try {
    const sessionIdHash = computeHMAC(rawSessionId);

    const result = await db`
      UPDATE sessions
      SET last_activity_at = CURRENT_TIMESTAMP
      WHERE id_hash = ${sessionIdHash}
        AND expires_at > CURRENT_TIMESTAMP
    `;

    return hasAffectedRows(result as DatabaseMutationResult);
  } catch {
    return false;
  }
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test:file src/server/services/sessions.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Run full check**

Run: `bun run check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/server/services/sessions.ts src/server/services/sessions.test.ts
git commit -m "feat: add sessions service with guest session support"
```

---

## Task 3: Refactor auth service

**Files:**
- Modify: `src/server/services/auth.ts`
- Modify: `src/server/services/auth.test.ts`

This task removes session CRUD and cookie helpers from auth.ts (now in sessions service) and updates `verifyMagicLink` to accept an optional guest session ID for upgrade.

- [ ] **Step 1: Update verifyMagicLink signature and implementation**

In `src/server/services/auth.ts`, change the import block at the top to add sessions service imports:

```ts
// Add this import
import {
  convertGuestToAuthenticated,
  createAuthenticatedSession,
} from "./sessions";
```

Then replace the `verifyMagicLink` function. The old function (lines 110-164) creates a session via `createSession`. The new one accepts `guestSessionId?` and tries to upgrade:

Old (lines 110-112):
```ts
export const verifyMagicLink = async (
  rawToken: string,
): Promise<AuthResult> => {
```

New:
```ts
export const verifyMagicLink = async (
  rawToken: string,
  guestSessionId?: string | null,
): Promise<AuthResult> => {
```

Old (line 155):
```ts
  const sessionId = await createSession(tokenData.user_id);
```

New:
```ts
  let sessionId: string;
  if (guestSessionId) {
    const guestHash = computeHMAC(guestSessionId);
    const converted = await convertGuestToAuthenticated(
      guestHash,
      tokenData.user_id,
    );
    sessionId = converted
      ? guestSessionId
      : await createAuthenticatedSession(tokenData.user_id);
  } else {
    sessionId = await createAuthenticatedSession(tokenData.user_id);
  }
```

- [ ] **Step 2: Remove session CRUD functions**

Remove these functions from `src/server/services/auth.ts` (they now live in sessions service):

- `createSession` (lines 171-182)
- `getSession` (lines 188-228)
- `deleteSession` (lines 234-247)
- `renewSession` (lines 253-268)

- [ ] **Step 3: Remove cookie helpers**

Remove these exports from `src/server/services/auth.ts`:

- `SESSION_COOKIE_NAME` (line 290)
- `SESSION_COOKIE_OPTIONS` (lines 291-297)
- `createSessionCookie` (lines 302-317)
- `clearSessionCookie` (lines 323-333)
- `getSessionIdFromCookies` (lines 339-352)

Also remove the `Session` interface (lines 15-21) and `SessionQueryResult` interface (lines 33-42) since they're no longer used here.

- [ ] **Step 4: Update auth.test.ts**

The auth tests that test `createSession`, `getSession`, `deleteSession`, `renewSession`, and the cookie helpers should be removed or moved. Tests for `verifyMagicLink` need updating to handle the new guest session upgrade path.

Remove test blocks for:
- `createSession`
- `getSession` / `deleteSession` / `renewSession`
- `createSessionCookie` / `clearSessionCookie` / `getSessionIdFromCookies`

Update `verifyMagicLink` tests:
- Import `createGuestSession` from sessions service
- Add test: "upgrades guest session when guestSessionId provided"
- Add test: "creates new session when no guestSessionId"
- Add test: "creates new session when guest upgrade fails"

Update imports at the top of auth.test.ts to remove deleted exports and add sessions service imports.

- [ ] **Step 5: Run tests**

Run: `bun run test:file src/server/services/auth.test.ts`
Expected: All remaining tests PASS

- [ ] **Step 6: Run full check**

Run: `bun run check`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/server/services/auth.ts src/server/services/auth.test.ts
git commit -m "refactor: move session CRUD to sessions service, add guest upgrade to verifyMagicLink"
```

---

## Task 4: Refactor auth middleware

**Files:**
- Modify: `src/server/middleware/auth.ts`
- Modify: `src/server/middleware/auth.test.ts`

- [ ] **Step 1: Rewrite middleware**

Replace the entire `src/server/middleware/auth.ts` with:

```ts
import type { BunRequest } from "bun";
import type { User } from "../services/auth";
import {
  type SessionContext,
  createGuestSession,
  getSessionContextFromDB,
  getSessionIdFromRequest,
  renewSession,
} from "../services/sessions";

export type { SessionContext };

const EMPTY_CONTEXT: SessionContext = {
  sessionId: null,
  sessionHash: null,
  sessionType: null,
  user: null,
  isGuest: false,
  isAuthenticated: false,
  requiresSetCookie: false,
};

const createGuestContext = async (): Promise<SessionContext> => {
  try {
    const sessionId = await createGuestSession();
    return {
      sessionId,
      sessionHash: null,
      sessionType: "guest",
      user: null,
      isGuest: true,
      isAuthenticated: false,
      requiresSetCookie: true,
    };
  } catch {
    return EMPTY_CONTEXT;
  }
};

export const getSessionContext = async (
  req: BunRequest,
): Promise<SessionContext> => {
  try {
    const sessionId = getSessionIdFromRequest(req);

    if (!sessionId) {
      return createGuestContext();
    }

    const ctx = await getSessionContextFromDB(sessionId);

    if (!ctx) {
      return createGuestContext();
    }

    if (ctx.isAuthenticated) {
      await renewSession(sessionId);
    }

    return ctx;
  } catch {
    return createGuestContext();
  }
};

export const requireAuth = async (
  req: BunRequest,
): Promise<Response | null> => {
  const ctx = await getSessionContext(req);

  if (!ctx.isAuthenticated) {
    return new Response("", {
      status: 303,
      headers: { Location: "/login" },
    });
  }

  return null;
};

export const redirectIfAuthenticated = async (
  req: BunRequest,
): Promise<Response | null> => {
  const ctx = await getSessionContext(req);

  if (ctx.isAuthenticated) {
    return new Response("", {
      status: 303,
      headers: { Location: "/" },
    });
  }

  return null;
};
```

- [ ] **Step 2: Update middleware tests**

Rewrite `src/server/middleware/auth.test.ts` to test `getSessionContext` instead of `getAuthContext`. Tests should:

- Mock `../services/sessions` module instead of `../services/auth`
- Test: no cookie → returns guest context with requiresSetCookie
- Test: valid guest cookie → returns guest context
- Test: valid authenticated cookie → returns authenticated context, calls renewSession
- Test: invalid/expired cookie → returns guest context with requiresSetCookie
- Test: error in lookup → returns guest context
- Test requireAuth and redirectIfAuthenticated with BunRequest

Use `createBunRequest` from test-utils for creating requests with cookies.

- [ ] **Step 3: Run tests**

Run: `bun run test:file src/server/middleware/auth.test.ts`
Expected: All tests PASS

- [ ] **Step 4: Run full check**

Run: `bun run check`
Expected: PASS (there will be TS errors in controllers that still import old auth exports — that's expected and fixed in Task 5)

Note: If `bun run check` fails due to controller imports of removed auth exports, that's OK. The typecheck will fail but lint should pass. Task 5 fixes the controllers.

- [ ] **Step 5: Commit**

```bash
git add src/server/middleware/auth.ts src/server/middleware/auth.test.ts
git commit -m "refactor: replace getAuthContext with getSessionContext using BunRequest"
```

---

## Task 5: Update controllers

**Files:**
- Modify: `src/server/controllers/auth/callback.tsx`
- Modify: `src/server/controllers/auth/logout.tsx`
- Modify: `src/server/controllers/app/home.tsx`
- Modify: `src/server/controllers/app/examples.tsx`
- Modify: `src/server/controllers/auth/login.tsx`
- Modify: All corresponding test files

- [ ] **Step 1: Update callback.tsx**

Replace entire file:

```tsx
import { verifyMagicLink } from "../../services/auth";
import { getSessionContext } from "../../middleware/auth";
import { setSessionCookie } from "../../services/sessions";
import { redirect } from "../../utils/response";

export const callback = {
  async index(req: BunRequest): Promise<Response> {
    const url = new URL(req.url);
    const token = url.searchParams.get("token");

    if (!token) {
      return redirect("/login?error=Missing authentication token");
    }

    try {
      const ctx = await getSessionContext(req);
      const guestSessionId = ctx.isGuest ? ctx.sessionId : null;

      const result = await verifyMagicLink(token, guestSessionId);

      if (!result.success) {
        return redirect(`/login?error=${encodeURIComponent(result.error)}`);
      }

      setSessionCookie(req, result.sessionId);

      return new Response("", {
        status: 303,
        headers: { Location: "/" },
      });
    } catch {
      return redirect("/login?error=Authentication failed. Please try again.");
    }
  },
};
```

- [ ] **Step 2: Update logout.tsx**

Replace entire file:

```tsx
import { csrfProtection } from "../../middleware/csrf";
import { getSessionContext } from "../../middleware/auth";
import {
  clearSessionCookie,
  deleteSession,
  getSessionIdFromRequest,
} from "../../services/sessions";

export const logout = {
  async create(req: BunRequest): Promise<Response> {
    const ctx = await getSessionContext(req);

    if (ctx.isAuthenticated && ctx.sessionId) {
      const csrfResponse = await csrfProtection(req, {
        method: "POST",
        path: "/auth/logout",
      });
      if (csrfResponse) {
        return csrfResponse;
      }

      try {
        await deleteSession(ctx.sessionId);
      } catch {
        // Session deletion failed, but still clear cookie for security
      }
    }

    clearSessionCookie(req);

    return new Response("", {
      status: 303,
      headers: { Location: "/login" },
    });
  },
};
```

- [ ] **Step 3: Update home.tsx**

Update to use `getSessionContext` and `setSessionCookie`. The controller needs to:
1. Call `getSessionContext(req)` instead of `getAuthContext(req)`
2. Use `ctx.sessionId` for CSRF token generation instead of manual cookie parsing
3. Call `setSessionCookie` if `ctx.requiresSetCookie`

Replace auth-related imports and update the handler to use the session context. The key changes:
- Import `getSessionContext` from `../../middleware/auth` instead of `getAuthContext`
- Import `setSessionCookie` from `../../services/sessions`
- Remove import of `getSessionIdFromCookies` from `../../services/auth`
- Use `ctx.sessionId` for CSRF token generation
- Add `setSessionCookie(req, ctx.sessionId)` when `ctx.requiresSetCookie`

- [ ] **Step 4: Update examples.tsx**

Same pattern as home.tsx:
- Replace `getAuthContext` with `getSessionContext`
- Replace `getSessionIdFromCookies` usage with `ctx.sessionId`
- Import `setSessionCookie` from sessions service
- Add `setSessionCookie` when `ctx.requiresSetCookie`

For the `create` and `destroy` methods that use `requireAuth`, update the request parameter type to `BunRequest`.

- [ ] **Step 5: Update login.tsx**

Update to use BunRequest type. The `redirectIfAuthenticated` call should work since it was updated to accept BunRequest in Task 4. Update the handler parameter from `Request` to `BunRequest`.

- [ ] **Step 6: Update controller tests**

Update all controller test files to:
- Mock `../../middleware/auth` with `getSessionContext` instead of `getAuthContext`
- Use `createBunRequest` (already available) for creating test requests
- Mock `../../services/sessions` for `setSessionCookie`, `clearSessionCookie`, `deleteSession`
- Update assertions for new API

Key test files to update:
- `callback.test.ts` — mock getSessionContext, verifyMagicLink, setSessionCookie
- `logout.test.ts` — mock getSessionContext, deleteSession, clearSessionCookie
- `home.test.ts` — mock getSessionContext instead of getAuthContext
- `examples.test.ts` — mock getSessionContext instead of getAuthContext
- `login.test.ts` — mock redirectIfAuthenticated (same as before, just BunRequest)
- `static.test.ts` — likely unchanged (about/contact don't use auth)

- [ ] **Step 7: Run all tests**

Run: `bun run test`
Expected: All tests PASS

- [ ] **Step 8: Run full check**

Run: `bun run check`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/server/controllers/ src/server/middleware/
git commit -m "refactor: update all controllers to use getSessionContext and BunRequest cookie API"
```

---

## Task 6: Final verification

- [ ] **Step 1: Run full test suite**

Run: `bun run test`
Expected: All tests PASS

- [ ] **Step 2: Run full lint + typecheck**

Run: `bun run check`
Expected: PASS

- [ ] **Step 3: Grep for old auth imports**

Search for `getAuthContext`, `createSessionCookie`, `clearSessionCookie`, `getSessionIdFromCookies`, and `createSession` (not `createAuthenticatedSession` or `createGuestSession`) in `src/server/` to verify no stale references remain.

Expected: Zero matches in production code (test files may still reference them in import mocks, that's OK)

- [ ] **Step 4: Grep for manual cookie parsing**

Search for `req.headers.get("cookie")` in controllers to verify all cookie access goes through the BunRequest API.

Expected: Zero matches in controller files (middleware and test files may still have it)
