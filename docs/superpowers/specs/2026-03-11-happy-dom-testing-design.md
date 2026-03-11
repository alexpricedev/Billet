# Happy-DOM Client Testing Infrastructure

## Goal

Close the backpressure gap on client-side code. Server templates are deterministic and tested; client scripts currently have zero automated feedback. Add happy-dom so `bun test` covers both server and client code in a single pass.

## Architecture

happy-dom runs as a bun test prelude that provides `document` and `window` globally. Client test files sit alongside the source they test (same co-location pattern as server tests). Each test sets up the DOM fixtures its script expects — the same elements the server template would render — then calls the `init()` function and asserts against the resulting DOM state.

No special framework wiring. No test utilities beyond what happy-dom gives you. The pattern is:

1. Set up HTML (the elements the server would have rendered)
2. Call `init()` (the same function `main.ts` calls)
3. Assert DOM state changed as expected

This works identically for vanilla JS, Preact islands, or anything else — because from the test's perspective it's all just "did the DOM end up right?"

## Test setup

A single prelude file at `src/client/test-utils/setup.ts` that imports happy-dom and assigns `window`, `document`, `HTMLElement`, etc. to globals. Bun's `preload` config in `bunfig.toml` loads it automatically for client test files.

Each test gets a fresh DOM by resetting `document.body.innerHTML = ""` in a `beforeEach`. No shared DOM state between tests.

The test script in `package.json` stays unified — `bun test src` runs both server and client tests in one pass. The prelude only provides DOM globals; it doesn't interfere with server tests that don't use them.

## What gets tested

**`home.ts`** — set up a `#counter` button and `#count` span, call `init()`, simulate click, assert `textContent` incremented.

**`contact.ts`** — set up a form with a name input, call `init()`, assert custom validation messages for empty/short/valid states, assert `submit` calls `preventDefault`.

**`about.ts`** — call `init()`, assert `document.body.style.backgroundColor` was set.

**`examples.ts`** — set up `#examples-search` and `#examples-list` with child elements, call `init()`, assert the Preact search component mounted and filtering works.

**`main.ts`** — set `document.body.dataset.page`, assert the right `init()` function gets called.

## What gets refactored

**`example-search.tsx`** — currently reaches outside itself to query `#examples-list` children. Refactor so it receives the example names as a prop and renders its own filterable list. This makes it a deterministic function of its inputs, consistent with how server templates work. The `examples.ts` init script passes the data in when mounting.
