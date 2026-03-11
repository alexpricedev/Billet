# Admin Middleware + Route Namespace Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add role-based admin authorization with a `requireAdmin` middleware, a `role` column on users, and a dedicated `/admin` route namespace.

**Architecture:** New migration adds `role` to users. `requireAdmin(req)` middleware follows the same return-value convention as `requireAuth` (`Response | null`) and also returns the `SessionContext` on success so callers avoid a redundant DB round-trip. A new `routes/admin.tsx` file groups all `/admin/*` routes, merged into `main.ts`. A placeholder `/admin` page demonstrates the pattern.

**Tech Stack:** Bun, TypeScript, PostgreSQL, JSX (server-rendered)

---

## Chunk 1: Database + Middleware + Routes

### Task 1: Add role column migration

**Files:**
- Create: `src/server/database/migrations/004_add_user_roles.ts`

- [ ] **Step 1: Write the migration file**

```typescript
import type { SQL } from "bun";

export const up = async (db: SQL): Promise<void> => {
  await db`
    ALTER TABLE users
    ADD COLUMN role VARCHAR(20) NOT NULL DEFAULT 'user'
    CHECK (role IN ('user', 'admin'))
  `;
};

export const down = async (db: SQL): Promise<void> => {
  await db`ALTER TABLE users DROP COLUMN role`;
};
```

- [ ] **Step 2: Run the migration**

Run: `bun run migrate up`
Expected: Migration 004 applied successfully.

- [ ] **Step 3: Verify the column exists**

Run: `bun run migrate status`
Expected: All migrations up to 004 shown as applied.

- [ ] **Step 4: Commit**

```bash
git add src/server/database/migrations/004_add_user_roles.ts
git commit -m "feat: add role column to users table"
```

---

### Task 2: Update User type to include role

**Files:**
- Modify: `src/server/services/auth.ts:9-13` (User interface)
- Modify: `src/server/services/sessions.ts:84-93` (SQL SELECT for user)
- Modify: `src/server/services/sessions.ts:97-117` (type cast and User construction)

- [ ] **Step 1: Update the User interface**

In `src/server/services/auth.ts`, change the `User` interface:

```typescript
export interface User {
  id: string;
  email: string;
  role: "user" | "admin";
  created_at: Date;
}
```

- [ ] **Step 2: Update getSessionContextFromDB query to select role**

In `src/server/services/sessions.ts`, update the SQL query inside `getSessionContextFromDB` to also select `u.role`:

```sql
SELECT
  s.id_hash, s.user_id, s.session_type,
  s.expires_at, s.last_activity_at, s.created_at,
  u.id as user_id_result, u.email, u.role, u.created_at as user_created_at
FROM sessions s
LEFT JOIN users u ON s.user_id = u.id
WHERE s.id_hash = ${sessionIdHash}
  AND s.expires_at > CURRENT_TIMESTAMP
```

- [ ] **Step 3: Update the type cast and User construction in getSessionContextFromDB**

Update the `data` type cast to include `role`:

```typescript
const data = result[0] as {
  id_hash: string;
  user_id: string | null;
  session_type: string;
  expires_at: string;
  last_activity_at: string;
  created_at: string;
  user_id_result: string | null;
  email: string | null;
  role: "user" | "admin" | null;
  user_created_at: string | null;
};
```

And update the User construction to include `role`:

```typescript
const user: User | null = isAuthenticated
  ? {
      id: data.user_id_result as string,
      email: data.email as string,
      role: (data.role as "user" | "admin") ?? "user",
      created_at: new Date(data.user_created_at as string),
    }
  : null;
```

- [ ] **Step 4: Update findOrCreateUser and verifyMagicLink queries to include role**

In `src/server/services/auth.ts`, update the SELECT queries to include `role`:

`findOrCreateUser` existing user query:
```sql
SELECT id, email, role, created_at FROM users WHERE email = ${normalizedEmail}
```

`findOrCreateUser` RETURNING clause:
```sql
RETURNING id, email, role, created_at
```

`verifyMagicLink` user query:
```sql
SELECT id, email, role, created_at FROM users WHERE id = ${tokenData.user_id}
```

And update the `userData` type cast in `verifyMagicLink`:
```typescript
const userData = userResults[0] as {
  id: string;
  email: string;
  role: "user" | "admin";
  created_at: string;
};
```

And the User construction in `verifyMagicLink`:
```typescript
const user: User = {
  id: userData.id,
  email: userData.email,
  role: userData.role,
  created_at: new Date(userData.created_at),
};
```

- [ ] **Step 5: Run existing tests to verify nothing broke**

Run: `bun run test:services`
Expected: All existing tests pass. The `role` column defaults to `'user'` so existing test users get that automatically.

Run: `bun run test:middleware`
Expected: All existing auth middleware tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/server/services/auth.ts src/server/services/sessions.ts
git commit -m "feat: add role field to User type and session queries"
```

---

### Task 3: Write admin middleware with tests (TDD)

**Files:**
- Create: `src/server/middleware/admin.ts`
- Create: `src/server/middleware/admin.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/server/middleware/admin.test.ts`:

```typescript
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { SQL } from "bun";
import { cleanupTestData } from "../test-utils/helpers";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for tests");
}
const connection = new SQL(process.env.DATABASE_URL);

mock.module("../services/database", () => ({
  get db() {
    return connection;
  },
}));

import { findOrCreateUser } from "../services/auth";
import { db } from "../services/database";
import { createAuthenticatedSession, createGuestSession } from "../services/sessions";
import { createBunRequest } from "../test-utils/bun-request";
import { requireAdmin } from "./admin";

describe("Admin Middleware", () => {
  beforeEach(async () => {
    await cleanupTestData(db);
  });

  afterAll(async () => {
    await connection.end();
  });

  test("returns authorized with session context for admin user", async () => {
    const user = await findOrCreateUser("admin@example.com");
    await db`UPDATE users SET role = 'admin' WHERE id = ${user.id}`;
    const sessionId = await createAuthenticatedSession(user.id);

    const request = createBunRequest("http://localhost:3000/admin", {
      headers: { cookie: `session_id=${sessionId}` },
    });

    const result = await requireAdmin(request);
    expect(result.authorized).toBe(true);
    if (result.authorized) {
      expect(result.ctx.user?.email).toBe("admin@example.com");
      expect(result.ctx.user?.role).toBe("admin");
    }
  });

  test("redirects unauthenticated user to /login", async () => {
    const request = createBunRequest("http://localhost:3000/admin");

    const result = await requireAdmin(request);

    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.response.status).toBe(303);
      expect(result.response.headers.get("location")).toBe("/login");
    }
  });

  test("redirects guest session to /login", async () => {
    const sessionId = await createGuestSession();

    const request = createBunRequest("http://localhost:3000/admin", {
      headers: { cookie: `session_id=${sessionId}` },
    });

    const result = await requireAdmin(request);

    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.response.status).toBe(303);
      expect(result.response.headers.get("location")).toBe("/login");
    }
  });

  test("redirects non-admin authenticated user to / with flash message", async () => {
    const user = await findOrCreateUser("regular@example.com");
    const sessionId = await createAuthenticatedSession(user.id);

    const request = createBunRequest("http://localhost:3000/admin", {
      headers: { cookie: `session_id=${sessionId}` },
    });

    const result = await requireAdmin(request);

    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.response.status).toBe(303);
      expect(result.response.headers.get("location")).toBe("/");
    }
  });

  test("redirects expired session to /login", async () => {
    const user = await findOrCreateUser("expired-admin@example.com");
    await db`UPDATE users SET role = 'admin' WHERE id = ${user.id}`;
    const sessionId = await createAuthenticatedSession(user.id);

    const { computeHMAC } = await import("../utils/crypto");
    const sessionIdHash = computeHMAC(sessionId);

    await db`
      UPDATE sessions
      SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 hour'
      WHERE id_hash = ${sessionIdHash}
    `;

    const request = createBunRequest("http://localhost:3000/admin", {
      headers: { cookie: `session_id=${sessionId}` },
    });

    const result = await requireAdmin(request);

    expect(result.authorized).toBe(false);
    if (!result.authorized) {
      expect(result.response.status).toBe(303);
      expect(result.response.headers.get("location")).toBe("/login");
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test:file src/server/middleware/admin.test.ts`
Expected: FAIL — `requireAdmin` does not exist yet.

- [ ] **Step 3: Write the admin middleware**

Create `src/server/middleware/admin.ts`:

```typescript
import type { BunRequest } from "bun";
import type { SessionContext } from "../services/sessions";
import { setFlashCookie } from "../utils/flash";
import { getSessionContext } from "./auth";

type AdminResult =
  | { authorized: true; ctx: SessionContext }
  | { authorized: false; response: Response };

export const requireAdmin = async (
  req: BunRequest,
): Promise<AdminResult> => {
  const ctx = await getSessionContext(req);

  if (!ctx.isAuthenticated) {
    return {
      authorized: false,
      response: new Response("", {
        status: 303,
        headers: { Location: "/login" },
      }),
    };
  }

  if (ctx.user?.role !== "admin") {
    setFlashCookie(req, "message", { text: "Admin access required" });
    return {
      authorized: false,
      response: new Response("", {
        status: 303,
        headers: { Location: "/" },
      }),
    };
  }

  return { authorized: true, ctx };
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test:file src/server/middleware/admin.test.ts`
Expected: All 5 tests PASS.

- [ ] **Step 5: Run full test suite**

Run: `bun run test`
Expected: All tests pass.

- [ ] **Step 6: Run lint and typecheck**

Run: `bun run check`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/server/middleware/admin.ts src/server/middleware/admin.test.ts
git commit -m "feat: add requireAdmin middleware with tests"
```

---

### Task 4: Add admin controller, template, and route file

**Files:**
- Create: `src/server/templates/admin-dashboard.tsx`
- Create: `src/server/controllers/admin/dashboard.tsx`
- Create: `src/server/controllers/admin/index.ts`
- Create: `src/server/routes/admin.tsx`
- Modify: `src/server/main.ts:2-3` (imports) and `src/server/main.ts:11-13` (routes spread)

- [ ] **Step 1: Create the admin dashboard template**

Create `src/server/templates/admin-dashboard.tsx`:

```tsx
import { Layout } from "@server/components/layouts";
import type { SessionContext } from "@server/middleware/auth";

export const AdminDashboard = (props: { auth: SessionContext }) => (
  <Layout title="Admin" name="admin">
    <h1>Admin</h1>
    <p>Logged in as {props.auth.user?.email}</p>
  </Layout>
);
```

- [ ] **Step 2: Create the admin dashboard controller**

Create `src/server/controllers/admin/dashboard.tsx`:

```tsx
import type { BunRequest } from "bun";
import { requireAdmin } from "../../middleware/admin";
import { AdminDashboard } from "../../templates/admin-dashboard";
import { render } from "../../utils/response";

export const admin = {
  async index(req: BunRequest): Promise<Response> {
    const result = await requireAdmin(req);
    if (!result.authorized) return result.response;

    return render(<AdminDashboard auth={result.ctx} />);
  },
};
```

- [ ] **Step 3: Create the admin barrel export**

Create `src/server/controllers/admin/index.ts`:

```typescript
export { admin } from "./dashboard";
```

- [ ] **Step 4: Create the admin routes file**

Create `src/server/routes/admin.tsx`:

```typescript
import { admin } from "../controllers/admin";

export const adminRoutes = {
  "/admin": admin.index,
};
```

- [ ] **Step 5: Register admin routes in main.ts**

In `src/server/main.ts`, add the import and spread the routes:

Add import:
```typescript
import { adminRoutes } from "./routes/admin";
```

Update routes object:
```typescript
routes: {
  ...appRoutes,
  ...adminRoutes,
  ...apiRoutes,
},
```

- [ ] **Step 6: Run lint and typecheck**

Run: `bun run check`
Expected: No errors.

- [ ] **Step 7: Run full test suite**

Run: `bun run test`
Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/server/templates/admin-dashboard.tsx src/server/controllers/admin/dashboard.tsx src/server/controllers/admin/index.ts src/server/routes/admin.tsx src/server/main.ts
git commit -m "feat: add admin route namespace with placeholder dashboard"
```

---

### Task 5: Add admin controller integration test

**Files:**
- Create: `src/server/controllers/admin/dashboard.test.ts`

- [ ] **Step 1: Write the controller test**

Create `src/server/controllers/admin/dashboard.test.ts`:

```typescript
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { SQL } from "bun";
import { cleanupTestData } from "../../test-utils/helpers";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for tests");
}
const connection = new SQL(process.env.DATABASE_URL);

mock.module("../../services/database", () => ({
  get db() {
    return connection;
  },
}));

import { findOrCreateUser } from "../../services/auth";
import { db } from "../../services/database";
import { createAuthenticatedSession } from "../../services/sessions";
import { createBunRequest } from "../../test-utils/bun-request";
import { admin } from "./dashboard";

describe("Admin Dashboard Controller", () => {
  beforeEach(async () => {
    await cleanupTestData(db);
  });

  afterAll(async () => {
    await connection.end();
  });

  test("renders admin dashboard for admin user", async () => {
    const user = await findOrCreateUser("admin@example.com");
    await db`UPDATE users SET role = 'admin' WHERE id = ${user.id}`;
    const sessionId = await createAuthenticatedSession(user.id);

    const request = createBunRequest("http://localhost:3000/admin", {
      headers: { cookie: `session_id=${sessionId}` },
    });

    const response = await admin.index(request);

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Admin");
    expect(html).toContain("admin@example.com");
  });

  test("redirects unauthenticated user to /login", async () => {
    const request = createBunRequest("http://localhost:3000/admin");

    const response = await admin.index(request);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login");
  });

  test("redirects non-admin user to /", async () => {
    const user = await findOrCreateUser("regular@example.com");
    const sessionId = await createAuthenticatedSession(user.id);

    const request = createBunRequest("http://localhost:3000/admin", {
      headers: { cookie: `session_id=${sessionId}` },
    });

    const response = await admin.index(request);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
  });
});
```

- [ ] **Step 2: Run the test**

Run: `bun run test:file src/server/controllers/admin/dashboard.test.ts`
Expected: All 3 tests PASS.

- [ ] **Step 3: Run full test suite and lint**

Run: `bun run test && bun run check`
Expected: All tests pass, no lint or type errors.

- [ ] **Step 4: Commit**

```bash
git add src/server/controllers/admin/dashboard.test.ts
git commit -m "test: add admin dashboard controller tests"
```

---

### Task 6: Update PRODUCTION-BACKPORT-ANALYSIS.md and memory

**Files:**
- Modify: `PRODUCTION-BACKPORT-ANALYSIS.md:45-49` (mark item 7 done)
- Modify: `/Users/alexprice/.claude/projects/-Users-alexprice-projects-SpeedLoaf/memory/MEMORY.md` (update completed items)

- [ ] **Step 1: Mark item 7 as done in backport analysis**

In `PRODUCTION-BACKPORT-ANALYSIS.md`, update item 7 to show it's done:
- Add `~~` strikethrough around the title and description
- Add `✅ Done` to the heading

- [ ] **Step 2: Update memory file**

Update the "Completed Backport Items" line to include item 7.

- [ ] **Step 3: Commit**

```bash
git add PRODUCTION-BACKPORT-ANALYSIS.md
git commit -m "docs: mark backport item #7 (admin middleware) as done"
```
