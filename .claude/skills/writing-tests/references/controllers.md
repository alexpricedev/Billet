# Controller tests

Mock the services the controller imports; assert on the real `Response` it returns.

## Shape

```ts
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Project } from "../../services/project";
import { createBunRequest } from "../../test-utils/bun-request";
import { testDatabase } from "../../test-utils/database";
import { cleanupTestData } from "../../test-utils/helpers";

// testDatabase(), never `new SQL(...)` — see CLAUDE.md. A guard test enforces it.
const connection = testDatabase();

// Mocks must run before the module under test is imported.
mock.module("../../services/database", () => ({ get db() { return connection; } }));

const mockGetProjects = mock(async (): Promise<Project[]> => []);
mock.module("../../services/project", () => ({ getProjects: mockGetProjects }));

import { projects } from "./projects";   // deliberately below the mocks

afterAll(async () => {
  await connection.end();
  mock.restore();
});
```

Controllers that touch sessions, CSRF, or auth still need a live connection even though the
domain service is mocked — sessions are stored in PostgreSQL. Clear each mock in `beforeEach`
with `mockClear()`.

## Building requests

`createBunRequest(url, init, params)` from `test-utils/bun-request.ts` returns a `BunRequest`
with `params` and a working `cookies` API. Use `findSetCookie(req, name)` /
`getSetCookieHeaders(req)` to assert on cookies the controller set.

`createMockRequest(url, method, body)` from `test-utils/setup.ts` is the lighter option when the
handler needs neither params nor cookies.

## API controllers

Assert the HTTP contract directly:

```ts
const res = await examplesApi.index(createMockRequest("http://localhost/api/examples"));
expect(res.status).toBe(200);
await expectJsonResponse(res, { examples: [] });
```

Cover the error paths — bad input, missing resource, unauthorised — not just the happy one.

## View controllers

Render the response body and assert on the HTML:

```ts
const res = await projects.index(createBunRequest("http://localhost/projects"));
expect(res.status).toBe(200);
expect(await res.text()).toContain("Test Project");
```

For redirects, assert the status and the `Location` header rather than the body:

```ts
expect(res.status).toBe(303);
expect(res.headers.get("Location")).toBe("/login");
```

Test the guest and the authenticated render of anything auth-aware — build a session with
`createAuthenticatedSession` / `createGuestSession` and pass the cookie through the request.

## Fixtures

`test-utils/factories.ts` has `createMockProject` and `createMockVisitorStats`, both taking an
overrides object. Add new factories there rather than hand-rolling shapes in each test.
