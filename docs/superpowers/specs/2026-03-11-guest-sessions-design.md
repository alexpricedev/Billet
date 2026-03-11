# Guest Session Service & BunRequest Cookie API — Design Spec

**Date:** 2026-03-11
**Backport items:** #4 (Guest session service + BunRequest cookie API), #5 (BunRequest test helpers with cookie mocking)
**Source:** PRODUCTION-BACKPORT-ANALYSIS.md

---

## Motivation

SpeedLoaf currently only creates sessions for authenticated users. Unauthenticated visitors have no session at all, which means no way to store per-visitor state (cart, filters, preferences) before login. Both production projects (realfast, sheffield-hindu-mandir) added auto-created guest sessions that upgrade in-place when the user logs in, preserving any data tied to the session.

The current code also parses cookies manually from the `Cookie` header string. Bun provides a native cookie API on `BunRequest` that is cleaner and less error-prone.

---

## SessionContext Type

```ts
type SessionType = "guest" | "authenticated";

interface SessionContext {
  sessionId: string | null;
  sessionHash: string | null;
  sessionType: SessionType | null;
  user: User | null;
  isGuest: boolean;
  isAuthenticated: boolean;
  requiresSetCookie: boolean;
}
```

Returned by `getSessionContext()` — replaces the current `getAuthContext()`. Every request gets a context; guests get auto-created sessions.

---

## Sessions Service

**New file:** `src/server/services/sessions.ts`

Owns all session lifecycle operations. The auth service (`auth.ts`) continues to own magic links and user management.

### Functions

**`createGuestSession()`** — Generate UUID, HMAC-hash it, insert into DB with `session_type = 'guest'`, `user_id = NULL`, `expires_at = NOW + 24h`. Returns raw UUID.

**`getSessionContextFromDB(rawSessionId: string)`** — Hash the raw ID, look up session with user join. Returns `SessionContext` or null if not found/expired.

**`convertGuestToAuthenticated(sessionHash: string, userId: string)`** — Atomic UPDATE: set `user_id`, `session_type = 'authenticated'`, `expires_at = NOW() + 30 days`. Only converts if current type is `'guest'` and not expired. Returns boolean.

**`createAuthenticatedSession(userId: string)`** — Generate UUID, HMAC-hash it, insert into DB with `session_type = 'authenticated'`, `user_id = userId`, `expires_at = NOW + 30 days`. Returns raw UUID. Used by `verifyMagicLink` when there's no guest session to upgrade.

**`deleteSession(rawSessionId: string)`** — Hash and delete from DB.

**`renewSession(rawSessionId: string)`** — Update `last_activity_at`. Only called for authenticated sessions — guest sessions are short-lived (24h) and don't need activity tracking.

### Cookie Helpers

```ts
getSessionIdFromRequest(req: BunRequest): string | null
  → req.cookies.get("session_id") || null

setSessionCookie(req: BunRequest, rawSessionId: string): void
  → req.cookies.set("session_id", rawSessionId, SESSION_COOKIE_OPTIONS)

clearSessionCookie(req: BunRequest): void
  → req.cookies.delete("session_id")
```

Cookie options: `httpOnly: true`, `secure` in production, `sameSite: "lax"`, `path: "/"`, `maxAge: 30 days`.

---

## Middleware Changes

**File:** `src/server/middleware/auth.ts`

### getSessionContext(req: BunRequest) → SessionContext

Replaces `getAuthContext(req: Request)`.

1. Read cookie via `getSessionIdFromRequest(req)`
2. No cookie → create guest session, return with `requiresSetCookie: true`
3. Cookie exists → `getSessionContextFromDB(sessionId)`
   - Not found → create guest session, `requiresSetCookie: true`
   - Found, guest → return guest context
   - Found, authenticated → `renewSession()`, return auth context
4. Any error → create guest session (never crash the request)

### requireAuth / redirectIfAuthenticated

Keep these, update signatures to take `BunRequest`. Internally call `getSessionContext()`.

---

## Auth Service Changes

**File:** `src/server/services/auth.ts`

### Removed exports (moved to sessions service)

- `createSession` → `createGuestSession` + session creation in `verifyMagicLink`
- `getSession` → `getSessionContextFromDB`
- `deleteSession` → sessions service
- `renewSession` → sessions service
- `createSessionCookie`, `clearSessionCookie`, `getSessionIdFromCookies` → replaced by BunRequest cookie helpers

### Modified: verifyMagicLink

```ts
verifyMagicLink(rawToken: string, guestSessionId?: string | null): Promise<AuthResult>
```

After verifying the token and finding/creating the user:

1. If `guestSessionId` provided → compute hash, call `convertGuestToAuthenticated(hash, userId)`
2. If conversion succeeds → reuse same session ID (guest data preserved)
3. If conversion fails or no guest session → call `createAuthenticatedSession(userId)` for a fresh session

Still owns: `findOrCreateUser`, `createMagicLink`, `verifyMagicLink`, `computeHMAC`.

---

## Controller Changes

All app and auth controllers switch from `getAuthContext(req: Request)` to `getSessionContext(req: BunRequest)`. This is a breaking change — controller handler signatures must also change from `Request` to `BunRequest` where they call session/auth middleware. Bun's route handlers already receive `BunRequest`, so this aligns with the runtime type.

**Pattern:**
```ts
const ctx = await getSessionContext(req);
if (ctx.requiresSetCookie && ctx.sessionId) {
  setSessionCookie(req, ctx.sessionId);
}
```

**Auth callback:** Passes `ctx.isGuest ? ctx.sessionId : null` to `verifyMagicLink` for guest→auth upgrade.

**Logout:** Uses `clearSessionCookie(req)` instead of manual Set-Cookie header building.

---

## Migration

**New file:** `src/server/database/migrations/003_add_guest_sessions.ts`

```sql
-- Up
ALTER TABLE sessions ADD COLUMN session_type VARCHAR(20) NOT NULL DEFAULT 'authenticated';
ALTER TABLE sessions ALTER COLUMN user_id DROP NOT NULL;
CREATE INDEX idx_sessions_session_type ON sessions(session_type);

-- Down
DELETE FROM sessions WHERE session_type = 'guest';
ALTER TABLE sessions ALTER COLUMN user_id SET NOT NULL;
DROP INDEX IF EXISTS idx_sessions_session_type;
ALTER TABLE sessions DROP COLUMN session_type;
```

---

## BunRequest Test Helpers

**File:** `src/server/test-utils/bun-request.ts`

Updated `createBunRequest()` adds a mock `cookies` object:

- Parses incoming `Cookie` header into a map
- `get(name)` — reads from parsed map
- `set(name, value, options)` — tracks set-cookies
- `delete(name)` — tracks cookie deletions

Assertion helpers:
- `getSetCookieHeaders(req)` — returns all set-cookie entries
- `findSetCookie(req, name)` — finds a specific set-cookie by name

---

## Error Handling

- `getSessionContext()` wraps in try/catch — any failure creates a guest session
- `convertGuestToAuthenticated()` returns boolean — failure falls back to new session
- Guest session creation failure returns context with all nulls (`isGuest: false`, `isAuthenticated: false`) — request still works

---

## Testing Strategy

- **Sessions service** — real PostgreSQL, test guest creation, lookup, upgrade, expiry
- **Auth middleware** — mock sessions service, verify `getSessionContext()` for each scenario
- **Controllers** — mock middleware, verify `setSessionCookie` called when `requiresSetCookie`
- **Auth controllers** — verify callback passes guest session for upgrade, logout clears cookie

---

## Out of Scope

- Session data storage (cart, filters, preferences) — domain-specific
- Admin middleware (backport #7)
- Rate limiting (backport #12)
