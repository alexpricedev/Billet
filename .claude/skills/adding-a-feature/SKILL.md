---
name: adding-a-feature
description: How a new page, API endpoint, or admin route is wired through this repo's layers, and which files must change together. Use when adding or removing a route, page, or endpoint, when a new route 404s or its client script never runs, or when scaffolding a new service.
---

# Adding a feature

The layering is strict, and it's what makes the codebase testable:

- **Routes** map a URL to a controller method. Nothing else.
- **Controllers** orchestrate — call services, then render a template or return JSON.
- **Services** own all business logic and data access. Controllers never query the database.
- **Templates** are pure presentation, receiving fully resolved data as props.

Data is fetched before render, so templates never need loading states.

Types are the contract between layers: export a type from the service alongside its functions and
import that same type in the controller and template. Don't redeclare the shape at each layer —
if a template's props drift from the service's return type, that's the bug.

Wiring is spread across several files and a missed one fails quietly. Follow the checklist for
what you're adding:

- New page → `references/page.md`
- New API endpoint → `references/api-endpoint.md`

Both end the same way: add the co-located test (see the `writing-tests` skill) and run
`bun run check` and `bun run test` (see `verifying-changes`).

## Migrations

New tables go in `src/server/database/migrations/` as `NNN_snake_case.ts`. Create one with
`bun run migrate:create`. They apply automatically on server start and at the top of the test
run — a failed migration means the server won't boot. Add any new table to `cleanupTestData` in
`src/server/test-utils/helpers.ts` or tests will bleed into each other.
