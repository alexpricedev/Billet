# Client tests

DOM globals come from happy-dom, preloaded for every test file via `bunfig.toml`
(`src/client/test-utils/setup.ts`). You don't register it yourself.

## Page scripts

Build a fixture matching the server-rendered HTML, call `init()`, assert on the DOM.

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

describe("projects page", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <table id="projects-list"><tbody><tr><td>Test Project</td></tr></tbody></table>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("filters rows", async () => {
    const { init } = await import("./projects");
    init();
    // ...assert
  });
});
```

Import the page module **dynamically inside the test**. A top-level import is cached across
tests in the same file, so `init()` would run against stale module state.

The fixture has to match what the server actually renders — the same ids, classes, and
`data-` attributes the script queries. If you change the template, change the fixture.

## Preact islands

Render into a container and assert on the output:

```tsx
import { render } from "preact";

const container = document.createElement("div");
document.body.appendChild(container);
render(<ProjectSearch projects={[{ id: 1, title: "Test" }]} />, container);
expect(container.textContent).toContain("Test");
```

Preact is the project-wide JSX runtime, so no pragma is needed. The file must be `.tsx` for the
JSX to compile.

Islands here reach outside their own tree (`ProjectSearch` toggles rows in the server-rendered
table by id), so the fixture usually needs that surrounding markup in `document.body` too.

## Page registration

Pages are wired in `src/client/main.ts` with `registerPage(name, { init })`, and dispatched from
`document.body.dataset.page` — set by the `name` prop on `<Layout>`. A page script that isn't
registered never runs, and no test will tell you.
