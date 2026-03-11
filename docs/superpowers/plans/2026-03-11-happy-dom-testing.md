# Happy-DOM Client Testing Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add happy-dom testing infrastructure so `bun test` provides backpressure on all client-side code.

**Architecture:** happy-dom's `GlobalRegistrator` runs as a bun test prelude via `bunfig.toml`, providing DOM globals to all tests. Client tests co-locate with source files. The `ExampleSearch` Preact component gets refactored from DOM-scraping to props-driven so it's deterministic and testable.

**Tech Stack:** happy-dom, @happy-dom/global-registrator, bun:test, Preact

**Spec:** `docs/superpowers/specs/2026-03-11-happy-dom-testing-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `bunfig.toml` | Configure test preload |
| Create | `src/client/test-utils/setup.ts` | happy-dom global registration |
| Create | `src/client/pages/home.test.ts` | Tests for home page init |
| Create | `src/client/pages/about.test.ts` | Tests for about page init |
| Create | `src/client/pages/contact.test.ts` | Tests for contact page init |
| Create | `src/client/pages/examples.test.ts` | Tests for examples page init |
| Create | `src/client/components/example-search.test.tsx` | Tests for ExampleSearch component |
| Create | `src/client/main.test.ts` | Tests for page router (conditional — see Task 9) |
| Modify | `src/client/components/example-search.tsx` | Refactor to receive data as props |
| Modify | `src/client/pages/examples.ts` | Pass example data when mounting |
| Modify | `src/server/templates/examples.tsx` | Add data attributes for client hydration |

---

## Chunk 1: Infrastructure

### Task 1: Install happy-dom

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install happy-dom as a dev dependency**

```bash
bun add -d happy-dom @happy-dom/global-registrator
```

- [ ] **Step 2: Verify installation**

```bash
bun run check
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add package.json bun.lock
git commit -m "Add happy-dom and global-registrator dev dependencies"
```

---

### Task 2: Create test prelude and bunfig.toml

**Files:**
- Create: `bunfig.toml`
- Create: `src/client/test-utils/setup.ts`

- [ ] **Step 1: Create the happy-dom prelude**

Create `src/client/test-utils/setup.ts`:

```typescript
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register({
  url: "http://localhost:3000",
  width: 1920,
  height: 1080,
});
```

- [ ] **Step 2: Create bunfig.toml with test preload**

Create `bunfig.toml` at project root:

```toml
[test]
preload = ["./src/client/test-utils/setup.ts"]
```

**Note on scope:** This prelude registers DOM globals for all tests, including server tests. Server tests don't use DOM globals, so the presence of `window`/`document` shouldn't affect them. Step 3 verifies this. If server tests break (e.g. a library detects `window` and changes behaviour), the fallback is to remove the prelude from `bunfig.toml` and instead import the setup file at the top of each client test file directly.

- [ ] **Step 3: Verify existing tests still pass**

Run the full test suite to confirm the prelude doesn't break server tests:

```bash
bun run test
```

Expected: All existing tests pass.

- [ ] **Step 4: Verify DOM globals are available**

Create `src/client/test-utils/setup.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";

describe("happy-dom prelude", () => {
  test("document is available globally", () => {
    expect(document).toBeDefined();
    expect(document.createElement).toBeInstanceOf(Function);
  });

  test("window is available globally", () => {
    expect(window).toBeDefined();
    expect(window.location.href).toBe("http://localhost:3000/");
  });
});
```

Run it:

```bash
bun run test:file src/client/test-utils/setup.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 5: Run lint and typecheck**

```bash
bun run check
```

Expected: Clean.

- [ ] **Step 6: Commit**

```bash
git add bunfig.toml src/client/test-utils/setup.ts src/client/test-utils/setup.test.ts
git commit -m "Add happy-dom test prelude with bunfig.toml preload"
```

---

## Chunk 2: Tests for vanilla page scripts

All page scripts export an `init()` function. Tests use top-level imports (not dynamic imports) to avoid module caching issues across tests. Each test file sets up its DOM fixtures in `beforeEach`, calls `init()`, and asserts DOM state.

### Task 3: Test home.ts

**Files:**
- Test: `src/client/pages/home.test.ts`
- Reference: `src/client/pages/home.ts`

The home page init sets up a click counter. It finds `#counter` (button) and `#count` (display), then increments the display text on each click.

- [ ] **Step 1: Write the tests**

Create `src/client/pages/home.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { init } from "./home";

describe("home page init", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <button id="counter">Click me</button>
      <span id="count">0</span>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("increments count on button click", () => {
    init();

    const button = document.getElementById("counter")!;
    const display = document.getElementById("count")!;

    button.click();
    expect(display.textContent).toBe("1");

    button.click();
    expect(display.textContent).toBe("2");
  });

  test("does nothing when elements are missing", () => {
    document.body.innerHTML = "";
    init();
  });
});
```

- [ ] **Step 2: Run the test**

```bash
bun run test:file src/client/pages/home.test.ts
```

Expected: All tests pass.

- [ ] **Step 3: Run lint and typecheck**

```bash
bun run check
```

Expected: Clean.

- [ ] **Step 4: Commit**

```bash
git add src/client/pages/home.test.ts
git commit -m "Add client tests for home page counter"
```

---

### Task 4: Test about.ts

**Files:**
- Test: `src/client/pages/about.test.ts`
- Reference: `src/client/pages/about.ts`

The about page init sets the body background colour.

- [ ] **Step 1: Write the test**

Create `src/client/pages/about.test.ts`:

```typescript
import { afterEach, describe, expect, test } from "bun:test";
import { init } from "./about";

describe("about page init", () => {
  afterEach(() => {
    document.body.style.backgroundColor = "";
  });

  test("sets body background colour", () => {
    init();
    expect(document.body.style.backgroundColor).toBe("#fef8e7");
  });
});
```

- [ ] **Step 2: Run the test**

```bash
bun run test:file src/client/pages/about.test.ts
```

Expected: Pass.

- [ ] **Step 3: Run lint and typecheck**

```bash
bun run check
```

Expected: Clean.

- [ ] **Step 4: Commit**

```bash
git add src/client/pages/about.test.ts
git commit -m "Add client test for about page background"
```

---

### Task 5: Test contact.ts

**Files:**
- Test: `src/client/pages/contact.test.ts`
- Reference: `src/client/pages/contact.ts`

The contact page init sets up form validation with custom messages and handles submit with `preventDefault`. The source code has three validation paths: `valueMissing`, `tooShort`, and valid.

- [ ] **Step 1: Write the tests**

Create `src/client/pages/contact.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { init } from "./contact";

describe("contact page init", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <form>
        <input name="name" required minlength="2" />
        <button type="submit">Send</button>
      </form>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("sets initial custom validation message", () => {
    init();

    const input = document.querySelector("input[name='name']") as HTMLInputElement;
    expect(input.validationMessage).toBe("Oi, enter your name.");
  });

  test("shows tooShort message for short input", () => {
    init();

    const input = document.querySelector("input[name='name']") as HTMLInputElement;

    // Programmatic .value doesn't set validity.tooShort in happy-dom,
    // so stub the validity object to simulate the browser behaviour
    input.value = "A";
    Object.defineProperty(input, "validity", {
      value: { valueMissing: false, tooShort: true },
      configurable: true,
    });
    input.dispatchEvent(new Event("input"));

    expect(input.validationMessage).toBe("Give me something more");
  });

  test("clears validation when input is valid", () => {
    init();

    const input = document.querySelector("input[name='name']") as HTMLInputElement;

    input.value = "Alex";
    input.dispatchEvent(new Event("input"));

    expect(input.validationMessage).toBe("");
  });

  test("prevents default form submission", () => {
    init();

    const form = document.querySelector("form")!;
    let defaultPrevented = false;

    form.addEventListener("submit", (e) => {
      defaultPrevented = e.defaultPrevented;
    });

    form.dispatchEvent(new Event("submit", { cancelable: true }));

    expect(defaultPrevented).toBe(true);
  });

  test("does nothing when form is missing", () => {
    document.body.innerHTML = "";
    init();
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
bun run test:file src/client/pages/contact.test.ts
```

Expected: All tests pass.

- [ ] **Step 3: Run lint and typecheck**

```bash
bun run check
```

Expected: Clean.

- [ ] **Step 4: Commit**

```bash
git add src/client/pages/contact.test.ts
git commit -m "Add client tests for contact form validation"
```

---

## Chunk 3: Refactor ExampleSearch and test

### Task 6: Write ExampleSearch tests first (TDD)

**Files:**
- Test: `src/client/components/example-search.test.tsx`

Write the tests for the new props-driven interface before refactoring the component. These tests will fail against the current implementation (which expects `{ total }` not `{ examples }`).

- [ ] **Step 1: Write the tests**

Create `src/client/components/example-search.test.tsx`:

```tsx
/** @jsxImportSource preact */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { render } from "preact";
import { ExampleSearch } from "./example-search";

const examples = [
  { id: 1, name: "Alpha" },
  { id: 2, name: "Beta" },
  { id: 3, name: "Gamma" },
];

describe("ExampleSearch", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);

    const list = document.createElement("div");
    list.id = "examples-list";
    for (const ex of examples) {
      const card = document.createElement("div");
      card.textContent = ex.name;
      list.appendChild(card);
    }
    document.body.appendChild(list);
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("renders search input", () => {
    render(<ExampleSearch examples={examples} />, container);
    const input = container.querySelector("input");
    expect(input).not.toBeNull();
    expect(input!.placeholder).toBe("Search examples...");
  });

  test("does not show count when query is empty", () => {
    render(<ExampleSearch examples={examples} />, container);
    const countText = container.querySelector("p");
    expect(countText).toBeNull();
  });

  test("filters and shows count when query is entered", async () => {
    render(<ExampleSearch examples={examples} />, container);
    const input = container.querySelector("input")!;

    input.value = "alpha";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    await new Promise((r) => setTimeout(r, 10));

    const countText = container.querySelector("p");
    expect(countText).not.toBeNull();
    expect(countText!.textContent).toContain("Showing 1 of 3");
  });

  test("hides non-matching cards in the server-rendered list", async () => {
    render(<ExampleSearch examples={examples} />, container);
    const input = container.querySelector("input")!;

    input.value = "beta";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    await new Promise((r) => setTimeout(r, 10));

    const cards = document.getElementById("examples-list")!.children;
    expect((cards[0] as HTMLElement).hidden).toBe(true);
    expect((cards[1] as HTMLElement).hidden).toBe(false);
    expect((cards[2] as HTMLElement).hidden).toBe(true);
  });

  test("shows all cards when query is cleared", async () => {
    render(<ExampleSearch examples={examples} />, container);
    const input = container.querySelector("input")!;

    input.value = "beta";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 10));

    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 10));

    const cards = document.getElementById("examples-list")!.children;
    for (const card of Array.from(cards)) {
      expect((card as HTMLElement).hidden).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
bun run test:file src/client/components/example-search.test.tsx
```

Expected: FAIL — the current component expects `{ total }` not `{ examples }`.

---

### Task 7: Refactor ExampleSearch to be props-driven

**Files:**
- Modify: `src/client/components/example-search.tsx`
- Modify: `src/client/pages/examples.ts`
- Modify: `src/server/templates/examples.tsx`

The component keeps a `useEffect` to toggle visibility on server-rendered `#examples-list` cards (this is a necessary DOM side-effect for the SSR-first architecture). The filtering logic itself is derived from the `examples` prop, making it deterministic and testable.

The `/** @jsxImportSource preact */` pragma at the top of `.tsx` files overrides the global `tsconfig.json` setting of `"jsxImportSource": "react"`. This is the established pattern in the codebase — test files that render Preact components must also include this pragma.

- [ ] **Step 1: Refactor ExampleSearch component**

Update `src/client/components/example-search.tsx`:

```tsx
/** @jsxImportSource preact */
import { useEffect, useState } from "preact/hooks";

interface ExampleItem {
  id: number;
  name: string;
}

export function ExampleSearch({ examples }: { examples: ExampleItem[] }) {
  const [query, setQuery] = useState("");

  const q = query.toLowerCase().trim();
  const matchCount = q
    ? examples.filter((ex) => ex.name.toLowerCase().includes(q)).length
    : examples.length;

  useEffect(() => {
    const list = document.getElementById("examples-list");
    if (!list) return;

    const cards = Array.from(list.children) as HTMLElement[];
    for (const card of cards) {
      const match = !q || (card.textContent ?? "").toLowerCase().includes(q);
      card.hidden = !match;
    }
  }, [q]);

  return (
    <div class="mb-4">
      <input
        type="text"
        placeholder="Search examples..."
        value={query}
        onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      />
      {q && (
        <p class="mt-2 text-sm text-gray-500">
          Showing {matchCount} of {examples.length}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Update the server template to pass data**

In `src/server/templates/examples.tsx`, change:

```tsx
<div id="examples-search" />
```

to:

```tsx
<div id="examples-search" data-examples={JSON.stringify(props.examples.map(e => ({ id: e.id, name: e.name })))} />
```

- [ ] **Step 3: Update the init script to read and pass the data**

Update `src/client/pages/examples.ts`:

```typescript
import { ExampleSearch } from "@client/components/example-search";
import { h, render } from "preact";

export function init() {
  const mount = document.getElementById("examples-search");
  if (!mount) return;

  const raw = mount.dataset.examples;
  const examples = raw ? JSON.parse(raw) : [];
  render(h(ExampleSearch, { examples }), mount);
}
```

- [ ] **Step 4: Run the ExampleSearch tests to verify they pass**

```bash
bun run test:file src/client/components/example-search.test.tsx
```

Expected: All 5 tests pass.

- [ ] **Step 5: Run full test suite**

```bash
bun run test
```

Expected: All tests pass.

- [ ] **Step 6: Run lint and typecheck**

```bash
bun run check
```

Expected: Clean.

- [ ] **Step 7: Commit**

```bash
git add src/client/components/example-search.tsx src/client/components/example-search.test.tsx src/client/pages/examples.ts src/server/templates/examples.tsx
git commit -m "Refactor ExampleSearch to receive example data as props"
```

---

### Task 8: Test examples.ts init

**Files:**
- Test: `src/client/pages/examples.test.ts`
- Reference: `src/client/pages/examples.ts`

- [ ] **Step 1: Write the test**

Create `src/client/pages/examples.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { init } from "./examples";

describe("examples page init", () => {
  beforeEach(() => {
    const mount = document.createElement("div");
    mount.id = "examples-search";
    mount.dataset.examples = JSON.stringify([
      { id: 1, name: "Test Example" },
    ]);
    document.body.appendChild(mount);
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("mounts ExampleSearch into #examples-search", async () => {
    init();

    await new Promise((r) => setTimeout(r, 10));

    const mount = document.getElementById("examples-search")!;
    const input = mount.querySelector("input");
    expect(input).not.toBeNull();
    expect(input!.placeholder).toBe("Search examples...");
  });

  test("does nothing when mount point is missing", () => {
    document.body.innerHTML = "";
    init();
  });
});
```

- [ ] **Step 2: Run the test**

```bash
bun run test:file src/client/pages/examples.test.ts
```

Expected: Pass.

- [ ] **Step 3: Run lint and typecheck**

```bash
bun run check
```

Expected: Clean.

- [ ] **Step 4: Commit**

```bash
git add src/client/pages/examples.test.ts
git commit -m "Add client tests for examples page init"
```

---

## Chunk 4: Page router test, final verification and docs

### Task 9: Test main.ts page router

**Files:**
- Test: `src/client/main.test.ts`
- Reference: `src/client/main.ts`

The page router reads `document.body.dataset.page` and calls the corresponding `init()` function. Since `main.ts` executes side-effects at the top level (not via an exported function), it can't be tested with a normal top-level import. Use `mock.module` to intercept page init functions and dynamic import to trigger execution.

- [ ] **Step 1: Write the test**

Create `src/client/main.test.ts`:

```typescript
import { afterEach, describe, expect, mock, test } from "bun:test";

describe("main page router", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    delete document.body.dataset.page;
  });

  test("calls home init when data-page is home", async () => {
    const mockInit = mock(() => {});
    mock.module("@client/pages/home", () => ({ init: mockInit }));

    document.body.dataset.page = "home";
    await import("./main");

    expect(mockInit).toHaveBeenCalled();
  });
});
```

**Note:** This test depends on `bun:test` re-executing a module's top-level code on dynamic import. If module caching prevents it from working (the test fails because `mockInit` is never called), delete the test file and move on — `main.ts` is a thin 3-line router already exercised by the page-level tests.

- [ ] **Step 2: Run the test**

```bash
bun run test:file src/client/main.test.ts
```

If it passes, continue. If module caching prevents it, delete the file and skip to Task 10.

- [ ] **Step 3: Run lint and typecheck**

```bash
bun run check
```

Expected: Clean.

- [ ] **Step 4: Commit (if test works)**

```bash
git add src/client/main.test.ts
git commit -m "Add client test for page router"
```

---

### Task 10: Final verification and docs update

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Run the full test suite**

```bash
bun run test
```

Expected: All tests pass (original server tests + new client tests).

- [ ] **Step 2: Run lint and typecheck**

```bash
bun run check
```

Expected: Clean.

- [ ] **Step 3: Update CLAUDE.md testing section**

Add a new testing strategy entry for client tests. Find the "Testing Strategies by Module Type" section and add after the "Test Utilities" entry:

```markdown
**Client Scripts** (`src/client/**/*.test.ts`):
- Use happy-dom for DOM globals (auto-loaded via bunfig.toml prelude)
- Set up DOM fixtures matching server-rendered HTML in `beforeEach`
- Clean up with `document.body.innerHTML = ""` in `afterEach`
- Call `init()` and assert DOM state changes
- For Preact components, render into a container and assert output
- Use top-level imports for page init functions (avoid dynamic imports to prevent module caching issues)
```

- [ ] **Step 4: Run lint and typecheck**

```bash
bun run check
```

Expected: Clean.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "Add client testing strategy to CLAUDE.md"
```
