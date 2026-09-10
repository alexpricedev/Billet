---
paths:
  - "src/server/services/**"
  - "src/server/database/**"
  - "src/server/utils/sql.ts"
  - "src/server/utils/sql-guard.ts"
---

# Writing SQL against Bun's driver

Loaded when you open a file that queries Postgres. The always-on rules — one guarded pool, one tag
— are in CLAUDE.md; this is what the guard catches, what it can't, and what to write instead.

## Four bindings that don't do what they look like

Bun's `SQL` tagged template binds JavaScript values as Postgres parameters, and four shapes go
wrong. Two of them corrupt data with no error at any layer, which is why the pool checks parameters
rather than trusting them:

| written | what Postgres receives |
|---|---|
| `${["a", "b"]}` | the string `"a,b"` |
| `= ANY(${ids})` | `insufficient data left in message` — an error naming neither the parameter nor the query |
| `${{ a: 1 }}` at a non-jsonb column | the string `"[object Object]"` |
| `${JSON.stringify(obj)}` at a `jsonb` column | a jsonb *string* — one long scalar that reads back as text and matches no query |

`sql.array()` is not the escape hatch for the first: it double-quotes every element, so `['A']`
arrives as `"A"` with the quotes inside the value.

## The guard

`guardPool` in `src/server/utils/sql-guard.ts` wraps a pool in a `Proxy` whose `apply` trap checks
every bound parameter, and both pools use it — `db` in `services/database.ts` and `testDatabase()`
in `test-utils/`. So a query that throws in production throws in a test, rather than passing there
and failing against live data.

It rejects an array, and a plain object that has not been declared with `jsonbValue()`. Everything
else passes untouched: primitives, `null`, `Date`, `Buffer`, and Bun's own `SQLHelper` fragments —
a fragment is a class instance, so it is not a plain object. The trap only inspects the
tagged-template call form, which carries `raw` on its first argument; `db(array)` and `db(object)`
are Bun building a fragment and pass straight through, which is what `inList` is built on.

A `Proxy` rather than a new tag every service must remember to import: `db` is already the only tag
in the codebase, so guarding it covers all of it without a call site changing, and `db.begin`,
`db.close` and the rest of the surface stay exactly as they were.

It throws in production too. A 500 is recoverable and a column full of `"[object Object]"` is not.

## The four helpers

`src/server/utils/sql.ts` is the writing half of `utils/database.ts` (which holds
`hasAffectedRows`, the reading half):

- **`jsonbValue(obj)`** — declares a value destined for a `jsonb` column. Returns it unchanged and
  records the intent, because Bun encodes jsonb correctly only from the raw object; there is
  nothing a wrapper could hand the driver, and no schema here to consult, so the caller naming the
  intent is what separates a jsonb object from an accidental one. Its signature does not accept a
  `string`, so `jsonbValue(JSON.stringify(prefs))` fails `bun run typecheck`.
- **`inList(values)`** — `WHERE id IN ${inList(ids)}`. Throws on an empty array rather than
  degrading, because `IN ()` is a syntax error and a fragment has no way to mean "no rows". Whether
  an empty set means an empty result or a skipped query is the caller's to know.
- **`textArrayLiteral(values)`** — the literal for a `text[]` *column*, bound as an ordinary string
  and cast: `${textArrayLiteral(tags)}::text[]`. Every element is quoted and backslashes and
  quotes escaped, so a comma or a brace in the data can't change the shape of the literal.
- **`expectQueryToReject(run, expected?)`** — in `test-utils/helpers.ts`, for asserting a query
  fails. `expect(db`…`).rejects` neither works nor fails: a tagged template is a lazy thenable
  rather than a Promise, so `.rejects` never settles and the file times out with no failing
  assertion to point at. The helper awaits the query inside a real async function, which is what
  gives Bun a promise to reject.

## The fence

`src/server/database/driver-safety.test.ts` fails the suite on the mistakes a running query can't
catch — `= ANY(${…})`, `sql.array()`, `expect()` on a tagged template, `JSON.stringify` inside a
query body, and a pool built outside the two that exist. Those only fail where they are written, so
that is where they fail. It is a `Rule[]` table in the same shape as
`src/client/boundaries.test.ts`; add an exemption only with the reason written next to it.

`src/server/test-utils/database.test.ts` is a different concern — pool *size* in test files, and
why it is capped at three. CLAUDE.md has the arithmetic.
