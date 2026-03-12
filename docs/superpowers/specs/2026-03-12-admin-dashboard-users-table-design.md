# Admin Dashboard — Users Table

## Overview

Expand the existing admin dashboard at `/admin` to display a read-only table of all registered users with their roles and join dates. The admin route, controller, middleware, and template already exist — this fills in the content.

## Scope

Read-only. No role editing, no user actions, no pagination. A simple table for a project template.

## Changes

### 1. Service: `src/server/services/users.ts`

New file. Exports:

- `User` type — re-exported from `auth.ts` (already defined there as `{ id, email, role, created_at }`)
- `getUsers(): Promise<User[]>` — queries all users ordered by `created_at DESC`

Follows the pattern in `example.ts`: query with `db` template literal, cast result, return.

### 2. Controller: `src/server/controllers/admin/dashboard.tsx`

Update `admin.index` to call `getUsers()` and pass the result to the template:

```tsx
const users = await getUsers();
return render(<AdminDashboard auth={result.ctx} users={users} />);
```

### 3. Template: `src/server/templates/admin-dashboard.tsx`

Expand to render a Tailwind-styled HTML table:

| Column  | Source         | Format                          |
|---------|----------------|---------------------------------|
| Email   | `user.email`   | Plain text                      |
| Role    | `user.role`    | Badge — visual distinction between "admin" and "user" |
| Joined  | `user.created_at` | Formatted date (e.g. "Mar 12, 2026") |

Props become `{ auth: SessionContext; users: User[] }`.

### 4. Tests

**Service test** (`src/server/services/users.test.ts`):
- Uses real PostgreSQL (following existing service test patterns)
- Seed users, call `getUsers()`, assert correct results and ordering

**Controller test** (`src/server/controllers/admin/dashboard.test.ts`):
- Mock `users` service and `requireAdmin` middleware
- Assert rendered HTML contains the table with expected user data
- Assert unauthorized requests get redirected

## Files touched

| File | Action |
|------|--------|
| `src/server/services/users.ts` | Create |
| `src/server/services/users.test.ts` | Create |
| `src/server/controllers/admin/dashboard.tsx` | Edit |
| `src/server/controllers/admin/dashboard.test.ts` | Create |
| `src/server/templates/admin-dashboard.tsx` | Edit |

## Out of scope

- Role editing / user management actions
- Pagination or search
- Session list per user
- Admin nav link in header
