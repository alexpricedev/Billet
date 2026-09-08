# Client tests

DOM globals come from happy-dom, preloaded for every test file via `bunfig.toml`
(`src/client/test-utils/setup.ts`). You don't register it yourself.

## Page scripts

Build a fixture matching the server-rendered HTML, call `init()`, assert on the DOM.

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

describe("forms page", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="form-card"><form><input name="name" required /></form></div>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("sets a custom validity message", async () => {
    const { init } = await import("./forms");
    init();
    // ...assert
  });
});
```

Import the page module **dynamically inside the test**. A top-level import is cached across
tests in the same file, so `init()` would run against stale module state.

The fixture has to match what the server actually renders — the same ids, classes, and
`data-` attributes the script queries. If you change the template, change the fixture.

## Components

A component binds to markup the server rendered, so the fixture is the template itself. Render it
with `renderToString`, take `<main>` out of an inert `<template>` (anywhere live, happy-dom would
try to fetch the layout's stylesheet and bundle), register the component, and `mount()`:

```tsx
import { renderToString } from "preact-render-to-string";
import { mount, registerComponent } from "@client/reactive/component";
import { Todos } from "@server/templates/todos";
import { todoList } from "./todo-list";

const template = document.createElement("template");
template.innerHTML = renderToString(<Todos todos={[…]} … />);
document.body.innerHTML = template.content.querySelector("main")?.innerHTML ?? "";

registerComponent(todoList);
const unmount = mount();

filterButton("Active").click();
expect(doneRow.hidden).toBe(true); // effects run synchronously — nothing to await
```

Because the fixture is the real template, a renamed id or a moved element fails here rather than in
the browser, and there is no hand-copied HTML to keep in step. Call the disposer `mount()` returns
in `afterEach` so the next test's `mount()` starts clean. `src/client/components/todo-list.test.tsx`
is the full example.

A component that calls `submitForm` needs `globalThis.fetch` replaced for the file (happy-dom's
fetch enforces the Same-Origin Policy and would go to the network). Queue `Response`s whose body is
the real row — `renderToString(<TodoRow … />)` — dispatch `submit` on the form, `await` one turn of
the event loop, and assert on the table. Restore the real `fetch` in `afterEach`.

For the reactive layer itself — a new binding attribute, say — write an inline fixture with a
throwaway component, as `src/client/reactive/component.test.ts` does. The registry is module
state, so give each throwaway component a unique name.

## Page registration

Pages are wired in `src/client/main.ts` with `registerPage(name, { init })`, and dispatched from
`document.body.dataset.page` — set by the `name` prop on `<Layout>`. A page script that isn't
registered never runs, and no test will tell you.
