# Service and middleware tests

Services run against a real PostgreSQL database from `.env.test` — real SQL, real constraints, no
query mocking.

## Shape

```ts
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { testDatabase } from "../test-utils/database";
import { cleanupTestData, seedTestData } from "../test-utils/helpers";

const connection = testDatabase();

mock.module("./database", () => ({
  get db() { return connection; },
}));

import { db } from "./database";
import { createProject, getProjects } from "./project";

describe("Project service", () => {
  beforeEach(async () => {
    await cleanupTestData(db);
  });

  afterAll(async () => {
    await connection.end();
    mock.restore();
  });
});
```

Four things this shape is load-bearing on:

- **The connection comes from `testDatabase()`.** Never `new SQL(...)` — the default pool is 10
  per file and `--parallel` runs one file per core, which exhausts `max_connections`. A guard test
  fails the suite if a test file constructs its own. See CLAUDE.md.

- **The mock precedes the imports.** `mock.module` has to run before the service module is
  evaluated, so the service imports sit below executable code. That is intentional; leave it.
- **The getter.** `get db()` defers resolution so the mock survives module caching.
- **`await connection.end()` in `afterAll`.** Without it the file hangs and the runner kills it
  at the 60s timeout.

## Isolation

`cleanupTestData(db)` truncates `user_tokens`, `sessions`, `users`, and `project`, and restarts
`project_id_seq`. Call it in `beforeEach`, not `afterEach` — a failed test then leaves its rows
behind for inspection. Extend that helper when you add a table rather than truncating inline.

`seedTestData(db)` inserts three known projects. `randomEmail()` gives a collision-free address
for user fixtures.

## What to cover

Full CRUD against real SQL, plus the cases the database enforces and TypeScript can't: unique
violations, foreign-key cascades, null columns, ordering guarantees.

## Middleware

Middleware in `src/server/middleware/` returns `Response | null` — a `Response` means "stop, this
is the answer", `null` means "carry on". Assert both branches. CSRF and auth middleware read
sessions from PostgreSQL, so they need the same live connection setup as services.

`csrfProtection` validates the request `Origin` against `APP_URL`, so requests built in tests need
a matching `Origin` header or an explicit `expectedOrigin` option.
