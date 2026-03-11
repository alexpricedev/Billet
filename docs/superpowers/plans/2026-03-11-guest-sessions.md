# Guest Sessions & BunRequest Cookie API — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add auto-created guest sessions for all visitors, upgrade to authenticated on login, and switch to BunRequest's native cookie API.

**Architecture:** New sessions service owns session lifecycle (create guest, lookup, upgrade, delete). Auth service keeps magic links and user management but delegates session operations. Middleware replaces `getAuthContext(Request)` with `getSessionContext(BunRequest)`. All controllers, CSRF middleware, and templates switch to the new API.

**Tech Stack:** Bun, TypeScript, PostgreSQL, Biome

**Spec:** `docs/superpowers/specs/2026-03-11-guest-sessions-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/server/database/migrations/003_add_guest_sessions.ts` | Add session_type column, make user_id nullable |
| Create | `src/server/services/sessions.ts` | Session lifecycle: guest creation, lookup, upgrade, delete, cookie helpers, cleanup |
| Create | `src/server/services/sessions.test.ts` | Sessions service tests (real DB) |
| Modify | `src/server/middleware/auth.ts` | Replace getAuthContext with getSessionContext, export SessionContext |
| Modify | `src/server/middleware/auth.test.ts` | Update tests for new middleware |
| Modify | `src/server/middleware/csrf.ts` | Switch from manual cookie parsing to BunRequest + sessions service |
| Modify | `src/server/middleware/csrf.test.ts` | Update tests for BunRequest-based CSRF middleware |
| Modify | `src/server/templates/home.tsx` | AuthContext → SessionContext |
| Modify | `src/server/controllers/auth/callback.tsx` | Use sessions service, pass guest session for upgrade |
| Modify | `src/server/controllers/auth/callback.test.ts` | Update mocks for new API |
| Modify | `src/server/controllers/auth/logout.tsx` | Use getSessionContext + sessions service cookie helpers |
| Modify | `src/server/controllers/auth/logout.test.ts` | Update mocks for new API |
| Modify | `src/server/controllers/app/home.tsx` | Switch to getSessionContext, BunRequest |
| Modify | `src/server/controllers/app/home.test.ts` | Update mocks for new API |
| Modify | `src/server/controllers/app/examples.tsx` | Switch to getSessionContext |
| Modify | `src/server/controllers/app/examples.test.ts` | Update mocks for new API |
| Modify | `src/server/services/auth.ts` | Remove session CRUD and cookie helpers; update verifyMagicLink |
| Modify | `src/server/services/auth.test.ts` | Update tests for refactored auth service |

**Not modified:** `src/server/controllers/auth/login.tsx` — already uses `BunRequest` and `redirectIfAuthenticated`, no changes needed.

---

## Task ordering rationale

Tasks are ordered so `bun run check` (lint + typecheck) passes after every commit.

1. **Task 1** (migration) and **Task 2** (sessions service) add new files only — nothing breaks.
2. **Task 3** (consumers) switches ALL consumers (middleware, CSRF, controllers, templates) to the new sessions API in one commit — nothing references removed auth exports afterward.
3. **Task 4** (auth cleanup) safely removes old exports from auth.ts since no consumers reference them.

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
  cleanupExpired,
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

describe("cleanupExpired", () => {
  test("removes expired sessions and tokens", async () => {
    const rawId = await createGuestSession();
    const hash = computeHMAC(rawId);
    await db`UPDATE sessions SET expires_at = NOW() - INTERVAL '1 hour' WHERE id_hash = ${hash}`;

    await cleanupExpired();

    const rows = await db`SELECT * FROM sessions WHERE id_hash = ${hash}`;
    expect(rows).toHaveLength(0);
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

export const cleanupExpired = async (): Promise<void> => {
  await db`
    DELETE FROM user_tokens
    WHERE expires_at < CURRENT_TIMESTAMP
  `;

  await db`
    DELETE FROM sessions
    WHERE expires_at < CURRENT_TIMESTAMP
  `;
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

## Task 3: Switch all consumers to new session API

This task updates ALL consumers of the old auth session/cookie exports in one commit. This ensures `bun run check` passes — no broken intermediate state.

**Files:**
- Modify: `src/server/middleware/auth.ts` + `auth.test.ts`
- Modify: `src/server/middleware/csrf.ts` + `csrf.test.ts`
- Modify: `src/server/templates/home.tsx`
- Modify: `src/server/controllers/auth/callback.tsx` + `callback.test.ts`
- Modify: `src/server/controllers/auth/logout.tsx` + `logout.test.ts`
- Modify: `src/server/controllers/app/home.tsx` + `home.test.ts`
- Modify: `src/server/controllers/app/examples.tsx` + `examples.test.ts`

- [ ] **Step 1: Rewrite auth middleware**

Replace the entire `src/server/middleware/auth.ts` with:

```ts
import type { BunRequest } from "bun";
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

- [ ] **Step 2: Update CSRF middleware**

In `src/server/middleware/csrf.ts`, make two changes:

1. Replace the import:

Old:
```ts
import { getSessionIdFromCookies } from "../services/auth";
```

New:
```ts
import type { BunRequest } from "bun";
import { getSessionIdFromRequest } from "../services/sessions";
```

2. Change the function signature and cookie reading:

Old:
```ts
export const csrfProtection = async (
  req: Request,
  options: CsrfOptions,
): Promise<Response | null> => {
```

New:
```ts
export const csrfProtection = async (
  req: BunRequest,
  options: CsrfOptions,
): Promise<Response | null> => {
```

Old (lines 47-49):
```ts
  const cookieHeader = req.headers.get("cookie");
  const sessionId = getSessionIdFromCookies(cookieHeader);
```

New:
```ts
  const sessionId = getSessionIdFromRequest(req);
```

Everything else in the function stays the same.

- [ ] **Step 3: Update home template**

In `src/server/templates/home.tsx`:

Old:
```tsx
import type { AuthContext } from "@server/middleware/auth";
```
New:
```tsx
import type { SessionContext } from "@server/middleware/auth";
```

Old:
```tsx
  auth: AuthContext;
```
New:
```tsx
  auth: SessionContext;
```

No other changes — the template uses `props.auth.isAuthenticated` and `props.auth.user?.email` which both exist on `SessionContext`.

- [ ] **Step 4: Update callback.tsx**

Replace the entire `src/server/controllers/auth/callback.tsx`:

```tsx
import type { BunRequest } from "bun";
import { getSessionContext } from "../../middleware/auth";
import { verifyMagicLink } from "../../services/auth";
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

Key changes: takes `BunRequest`, calls `getSessionContext` to get guest session for upgrade, uses `setSessionCookie(req, ...)` instead of manual `Set-Cookie` header.

- [ ] **Step 5: Update logout.tsx**

Replace the entire `src/server/controllers/auth/logout.tsx`:

```tsx
import type { BunRequest } from "bun";
import { getSessionContext } from "../../middleware/auth";
import { csrfProtection } from "../../middleware/csrf";
import {
  clearSessionCookie,
  deleteSession,
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
        // Session deletion failed — still clear cookie
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

Key changes: takes `BunRequest`, uses `getSessionContext` instead of manual session lookup, uses `clearSessionCookie(req)` and `deleteSession` from sessions service instead of auth service, no manual `Set-Cookie` header.

- [ ] **Step 6: Update home.tsx controller**

Replace the entire `src/server/controllers/app/home.tsx`:

```tsx
import type { BunRequest } from "bun";
import { getSessionContext } from "../../middleware/auth";
import { createCsrfToken } from "../../services/csrf";
import { setSessionCookie } from "../../services/sessions";
import { getVisitorStats } from "../../services/analytics";
import { Home } from "../../templates/home";
import { render } from "../../utils/response";

export const home = {
  async index(req: BunRequest): Promise<Response> {
    const [stats, ctx] = await Promise.all([
      getVisitorStats(),
      getSessionContext(req),
    ]);

    if (ctx.requiresSetCookie && ctx.sessionId) {
      setSessionCookie(req, ctx.sessionId);
    }

    let csrfToken: string | null = null;
    if (ctx.isAuthenticated && ctx.sessionId) {
      csrfToken = await createCsrfToken(ctx.sessionId, "POST", "/auth/logout");
    }

    return render(
      <Home
        method={req.method}
        stats={stats}
        auth={ctx}
        csrfToken={csrfToken}
      />,
    );
  },
};
```

Key changes: `BunRequest` instead of `Request`, `getSessionContext` instead of `getAuthContext`, `ctx.sessionId` for CSRF instead of manual cookie parsing, `setSessionCookie` for guest sessions.

- [ ] **Step 7: Update examples.tsx controller**

Replace the entire `src/server/controllers/app/examples.tsx`:

```tsx
import type { BunRequest } from "bun";
import { getSessionContext, requireAuth } from "../../middleware/auth";
import { csrfProtection } from "../../middleware/csrf";
import { createCsrfToken } from "../../services/csrf";
import { setSessionCookie } from "../../services/sessions";
import {
  createExample,
  deleteExample,
  getExamples,
} from "../../services/example";
import type { ExamplesState } from "../../templates/examples";
import { Examples } from "../../templates/examples";
import { redirect, render } from "../../utils/response";
import { stateHelpers } from "../../utils/state";

const { getFlash, setFlash } = stateHelpers<ExamplesState>();

export const examples = {
  async index(req: BunRequest): Promise<Response> {
    const ctx = await getSessionContext(req);

    if (ctx.requiresSetCookie && ctx.sessionId) {
      setSessionCookie(req, ctx.sessionId);
    }

    const examples = await getExamples();

    if (!ctx.isAuthenticated || !ctx.sessionId) {
      return render(<Examples examples={examples} isAuthenticated={false} />);
    }

    const state = getFlash(req);

    const createCsrfTokenValue = await createCsrfToken(
      ctx.sessionId,
      "POST",
      "/examples",
    );

    const deleteCsrfTokens: Record<number, string> = {};
    for (const example of examples) {
      deleteCsrfTokens[example.id] = await createCsrfToken(
        ctx.sessionId,
        "POST",
        `/examples/${example.id}/delete`,
      );
    }

    return render(
      <Examples
        createCsrfToken={createCsrfTokenValue}
        deleteCsrfTokens={deleteCsrfTokens}
        examples={examples}
        isAuthenticated={ctx.isAuthenticated}
        state={state}
      />,
    );
  },

  async create(req: BunRequest): Promise<Response> {
    const authRedirect = await requireAuth(req);
    if (authRedirect) {
      return authRedirect;
    }

    const csrfResponse = await csrfProtection(req, {
      method: "POST",
      path: "/examples",
    });
    if (csrfResponse) {
      return csrfResponse;
    }

    const formData = await req.formData();
    const name = formData.get("name") as string;

    if (!name || name.trim().length < 2) {
      return redirect("/examples");
    }

    await createExample(name.trim());
    setFlash(req, { state: "submission-success" });
    return redirect("/examples");
  },

  async destroy<T extends `${string}:id${string}`>(
    req: BunRequest<T>,
  ): Promise<Response> {
    const authRedirect = await requireAuth(req);
    if (authRedirect) {
      return authRedirect;
    }

    const csrfResponse = await csrfProtection(req, {
      method: "POST",
      path: req.url,
    });
    if (csrfResponse) {
      return csrfResponse;
    }

    const idParam = req.params.id;
    const id = Number.parseInt(idParam, 10);

    if (!idParam || Number.isNaN(id)) {
      return redirect("/examples");
    }

    const deleted = await deleteExample(id);

    if (!deleted) {
      return redirect("/examples");
    }

    setFlash(req, { state: "deletion-success" });
    return redirect("/examples");
  },
};
```

Key changes: `getSessionContext` instead of `getAuthContext`, `ctx.sessionId` for CSRF instead of `getSessionIdFromCookies`, `setSessionCookie` for guest sessions.

- [ ] **Step 8: Update auth middleware tests**

Rewrite `src/server/middleware/auth.test.ts` to test `getSessionContext` instead of `getAuthContext`. Mock `../services/sessions` instead of `../services/auth`. Use `createBunRequest` from test-utils.

Test scenarios:
- No cookie → creates guest session, returns guest context with `requiresSetCookie: true`
- Valid guest cookie → returns guest context with `isGuest: true`
- Valid authenticated cookie → returns authenticated context, calls `renewSession`
- Invalid/expired cookie → creates guest session, returns guest context with `requiresSetCookie: true`
- DB error → creates guest session (never crashes)
- `requireAuth` with unauthenticated → returns 303 redirect to /login
- `requireAuth` with authenticated → returns null
- `redirectIfAuthenticated` with authenticated → returns 303 redirect to /
- `redirectIfAuthenticated` with unauthenticated → returns null

- [ ] **Step 9: Update CSRF middleware tests**

Update `src/server/middleware/csrf.test.ts`:
- Replace `new Request(url, { headers: { Cookie: ... } })` with `createBunRequest(url, { headers: { Cookie: "session_id=<raw-id>" } })` from test-utils
- Remove imports of `createSessionCookie` from `../../services/auth`
- Mock `../../services/sessions` module for `getSessionIdFromRequest` if needed, OR pass cookies through `createBunRequest`'s cookies support

The CSRF tests should still test the same behaviors (token validation, origin checking, etc.) — only the request construction changes.

- [ ] **Step 10: Update controller tests**

For each controller test file, update:

**`callback.test.ts`:**
- Mock `../../middleware/auth` with `getSessionContext` (returns guest context by default)
- Mock `../../services/sessions` for `setSessionCookie`
- Mock `../../services/auth` for `verifyMagicLink` only
- Use `createBunRequest` for test requests
- Verify `setSessionCookie` called with session ID on success
- Verify guest session ID passed to `verifyMagicLink`

**`logout.test.ts`:**
- Mock `../../middleware/auth` with `getSessionContext` (returns authenticated context)
- Mock `../../services/sessions` for `clearSessionCookie`, `deleteSession`
- Remove imports of `createSessionCookie`, `clearSessionCookie`, `getSessionIdFromCookies`, `getSession`, `deleteSession` from auth service
- Use `createBunRequest` for test requests
- Verify `deleteSession` and `clearSessionCookie` called

**`home.test.ts`:**
- Mock `../../middleware/auth` with `getSessionContext` instead of `getAuthContext`
- Mock `../../services/sessions` for `setSessionCookie`
- Verify `setSessionCookie` called when `requiresSetCookie` is true
- Verify CSRF token generated using `ctx.sessionId`

**`examples.test.ts`:**
- Mock `../../middleware/auth` with `getSessionContext` and `requireAuth` instead of `getAuthContext`
- Mock `../../services/sessions` for `setSessionCookie`
- Remove import of `createSessionCookie` and `getSessionIdFromCookies` from auth service
- Use `createBunRequest` for all test requests (already does for some)
- Verify `setSessionCookie` called when `requiresSetCookie` is true

**`login.test.ts`:**
- No changes expected — already uses `redirectIfAuthenticated` mock and `BunRequest`

- [ ] **Step 11: Run all tests**

Run: `bun run test`
Expected: All tests PASS

- [ ] **Step 12: Run full check**

Run: `bun run check`
Expected: PASS — no TS errors, no lint warnings

- [ ] **Step 13: Commit**

```bash
git add src/server/middleware/ src/server/controllers/ src/server/templates/home.tsx
git commit -m "refactor: switch all consumers to getSessionContext and BunRequest cookie API"
```

---

## Task 4: Auth service cleanup

**Files:**
- Modify: `src/server/services/auth.ts`
- Modify: `src/server/services/auth.test.ts`

All consumers were updated in Task 3. Now we safely remove old session/cookie exports and update `verifyMagicLink`.

- [ ] **Step 1: Update verifyMagicLink signature and implementation**

Add imports at the top of `src/server/services/auth.ts`:

```ts
import {
  convertGuestToAuthenticated,
  createAuthenticatedSession,
} from "./sessions";
```

Change verifyMagicLink signature (line 110):

Old:
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

Replace the session creation line (currently `const sessionId = await createSession(tokenData.user_id);`):

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

- [ ] **Step 2: Remove old session CRUD functions**

Remove from `src/server/services/auth.ts`:
- `Session` interface (lines 15-21)
- `SessionQueryResult` interface (lines 33-42)
- `createSession` function (lines 171-182)
- `getSession` function (lines 188-228)
- `deleteSession` function (lines 234-247)
- `renewSession` function (lines 253-268)

- [ ] **Step 3: Remove old cookie helpers and cleanupExpired**

Remove from `src/server/services/auth.ts`:
- `cleanupExpired` function (lines 274-284) — now in sessions service
- `SESSION_COOKIE_NAME` (line 290)
- `SESSION_COOKIE_OPTIONS` (lines 291-297)
- `createSessionCookie` function (lines 302-317)
- `clearSessionCookie` function (lines 323-333)
- `getSessionIdFromCookies` function (lines 339-352)

Auth service should now only export: `User`, `UserToken`, `AuthResult`, `findOrCreateUser`, `createMagicLink`, `verifyMagicLink`.

- [ ] **Step 4: Update auth.test.ts**

Remove test blocks for:
- `createSession`
- `getSession` / `deleteSession` / `renewSession`
- `createSessionCookie` / `clearSessionCookie` / `getSessionIdFromCookies`
- `cleanupExpired` (tested in sessions.test.ts)

Update `verifyMagicLink` tests:
- Import `createGuestSession` from sessions service (dynamic import with mock)
- Add test: "upgrades guest session when guestSessionId provided" — create guest session, call `verifyMagicLink(token, guestSessionId)`, verify session type changed to authenticated
- Add test: "creates new session when no guestSessionId" — call `verifyMagicLink(token)`, verify new authenticated session created
- Add test: "creates new session when guest upgrade fails (expired guest)" — expire the guest session, call `verifyMagicLink(token, guestSessionId)`, verify new authenticated session created instead

Update imports at top of auth.test.ts: remove deleted exports, add sessions service imports.

- [ ] **Step 5: Run tests**

Run: `bun run test:file src/server/services/auth.test.ts`
Expected: All remaining tests PASS

- [ ] **Step 6: Run full test suite**

Run: `bun run test`
Expected: All tests PASS

- [ ] **Step 7: Run full check**

Run: `bun run check`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/server/services/auth.ts src/server/services/auth.test.ts
git commit -m "refactor: remove old session CRUD from auth service, add guest upgrade to verifyMagicLink"
```

---

## Task 5: Final verification

- [ ] **Step 1: Run full test suite**

Run: `bun run test`
Expected: All tests PASS

- [ ] **Step 2: Run full lint + typecheck**

Run: `bun run check`
Expected: PASS

- [ ] **Step 3: Grep for old auth imports**

Search for `getAuthContext`, `createSessionCookie`, `clearSessionCookie`, `getSessionIdFromCookies`, and `createSession` (not `createAuthenticatedSession` or `createGuestSession`) in `src/server/` to verify no stale references remain.

Expected: Zero matches in production code. Test mocks may reference old names in mock setup — that's fine as long as they're not importing from auth service.

- [ ] **Step 4: Grep for manual cookie parsing**

Search for `req.headers.get("cookie")` in controllers and middleware to verify all cookie access goes through the BunRequest API.

Expected: Zero matches in controllers and middleware production code.

- [ ] **Step 5: Verify AuthContext is gone**

Search for `AuthContext` in `src/server/` — should only appear in test mock definitions, not in production code.

Expected: Zero matches in production code.
