# Admin Middleware + Route Namespace

## Context

Both production projects (realfast, sheffield-hindu-mandir) added role-based admin middleware and a dedicated admin route file. This backports that pattern into the SpeedLoaf template.

## Design

### Database Migration

Add a `role` column to the `users` table:

```sql
ALTER TABLE users
ADD COLUMN role VARCHAR(20) NOT NULL DEFAULT 'user'
CHECK (role IN ('user', 'admin'))
```

Update the `User` interface in `src/server/services/auth.ts`:

```typescript
export interface User {
  id: string;
  email: string;
  role: "user" | "admin";
  created_at: Date;
}
```

### Admin Middleware

**File:** `src/server/middleware/admin.ts`

A single `requireAdmin(req: BunRequest)` function returning `Promise<AdminResult>` — a discriminated union:

- `{ authorized: true, ctx: SessionContext }` — admin access granted, includes session context to avoid redundant DB calls
- `{ authorized: false, response: Response }` — access denied, response to return

Behavior:
- Calls `getSessionContext(req)` to get auth state
- Not authenticated: redirect 303 to `/login`
- Authenticated, not admin: redirect 303 to `/` with flash cookie "Admin access required"
- Admin: return authorized result with `SessionContext`

### Admin Routes

**File:** `src/server/routes/admin.tsx`

Exports `adminRoutes` object. Ships with one placeholder:

```typescript
export const adminRoutes = {
  "/admin": admin.index,
};
```

### Admin Controller

**File:** `src/server/controllers/admin/dashboard.tsx`

Single controller with `index` method:

1. Call `requireAdmin(req)` — early return if denied
2. Render a minimal admin placeholder page

Barrel export from `src/server/controllers/admin/index.ts`.

### Server Registration

**File:** `src/server/main.ts`

Spread `...adminRoutes` into the Bun.serve routes config alongside `appRoutes` and `apiRoutes`.

### Files Changed

| File | Action |
|------|--------|
| `src/server/database/migrations/004_add_user_roles.ts` | New migration |
| `src/server/services/auth.ts` | Add `role` to User interface and queries |
| `src/server/services/sessions.ts` | Include `role` in session context query |
| `src/server/middleware/admin.ts` | New middleware |
| `src/server/routes/admin.tsx` | New route file |
| `src/server/controllers/admin/dashboard.tsx` | New controller |
| `src/server/controllers/admin/index.ts` | New barrel export |
| `src/server/main.ts` | Register admin routes |
| `src/server/templates/admin-dashboard.tsx` | New placeholder template |
