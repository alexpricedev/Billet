import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mount, registerComponent } from "@client/reactive/component";
import { TodoRow } from "@server/components/todo-row";
import type { Todo } from "@server/services/todo";
import { Todos } from "@server/templates/todos";
import { CSRF_HEADER, FRAGMENT_HEADER } from "@shared/protocol";
import { renderToString } from "preact-render-to-string";
import { todoList } from "./todo-list";

// The fixture is the real template. The page is parsed into a <template>,
// whose content is inert, and only <main> goes into the document — anywhere
// live, happy-dom would try to fetch the layout's stylesheet and bundle.
const mainOf = (html: string): string => {
  const template = document.createElement("template");
  template.innerHTML = html;
  const main = template.content.querySelector("main");
  if (!main) throw new Error("Template rendered no <main>");
  return main.innerHTML;
};

const seed: Todo[] = [
  { id: 1, title: "Alpha", completed_at: null, created_by: null },
  { id: 2, title: "Beta", completed_at: new Date(), created_by: null },
  { id: 3, title: "Gamma", completed_at: null, created_by: null },
];

const page = (isAuthenticated: boolean, todos = seed) =>
  mainOf(
    renderToString(
      <Todos
        todos={todos}
        state={{}}
        isAuthenticated={isAuthenticated}
        createCsrfToken="create-token"
        toggleCsrfTokens={{ 1: "t1", 2: "t2", 3: "t3" }}
        deleteCsrfTokens={isAuthenticated ? { 1: "d1", 2: "d2", 3: "d3" } : {}}
        user={null}
      />,
    ),
  );

// What the server answers a fragment request with.
const rowHtml = (todo: Todo, showActions = false) =>
  renderToString(
    <TodoRow
      todo={todo}
      toggleCsrfToken="fresh-toggle"
      deleteCsrfToken={showActions ? "fresh-delete" : null}
      showActions={showActions}
    />,
  );

registerComponent(todoList);

type Call = { url: string; init: RequestInit };
const calls: Call[] = [];
let responses: Response[] = [];
const realFetch = globalThis.fetch;

let unmount: () => void = () => {};

beforeEach(() => {
  calls.length = 0;
  responses = [];
  globalThis.fetch = mock(
    async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      const next = responses.shift();
      if (!next) throw new Error("No response queued");
      return next;
    },
  ) as unknown as typeof fetch;
});

afterEach(() => {
  unmount();
  unmount = () => {};
  globalThis.fetch = realFetch;
  document.body.innerHTML = "";
});

const load = (isAuthenticated = false, todos = seed) => {
  document.body.innerHTML = page(isAuthenticated, todos);
  unmount = mount();
};

const rows = (): HTMLTableRowElement[] =>
  Array.from(
    document.querySelectorAll<HTMLTableRowElement>("tbody tr[data-id]"),
  );
const visibleTitles = () =>
  rows()
    .filter((row) => !row.hidden)
    .map((row) => row.querySelector(".todo-title")?.textContent);
const count = () => document.querySelector(".todo-count")?.textContent;
const emptyRow = () => document.querySelector<HTMLElement>(".empty-row");
const filterButton = (label: string): HTMLButtonElement => {
  const button = Array.from(
    document.querySelectorAll<HTMLButtonElement>(".filter-btn"),
  ).find((el) => el.textContent === label);
  if (!button) throw new Error(`No ${label} filter`);
  return button;
};
const submit = (form: Element | null) => {
  if (!(form instanceof HTMLFormElement)) throw new Error("No form");
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
};
// submitForm awaits fetch and the body read; two turns of the loop is enough.
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("todo list", () => {
  test("mounts on the template's root with the server's count", () => {
    load();
    const root = document.querySelector('[data-component="todo-list"]');
    expect(root?.hasAttribute("data-mounted")).toBe(true);
    expect(count()).toBe("2 items left");
    expect(rows().every((row) => !row.hidden)).toBe(true);
    expect(emptyRow()?.hidden).toBe(true);
  });

  test("filters by completion and reflects the active filter", () => {
    load();

    filterButton("Active").click();
    expect(visibleTitles()).toEqual(["Alpha", "Gamma"]);
    expect(filterButton("Active").getAttribute("aria-pressed")).toBe("true");
    expect(filterButton("Active").classList.contains("active")).toBe(true);
    expect(filterButton("All").getAttribute("aria-pressed")).toBe("false");
    expect(filterButton("All").classList.contains("active")).toBe(false);

    filterButton("Completed").click();
    expect(visibleTitles()).toEqual(["Beta"]);

    filterButton("All").click();
    expect(visibleTitles()).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  test("shows the empty row when a filter matches nothing", () => {
    load(false, [seed[0]]);

    filterButton("Completed").click();
    expect(visibleTitles()).toEqual([]);
    expect(emptyRow()?.hidden).toBe(false);

    filterButton("All").click();
    expect(emptyRow()?.hidden).toBe(true);
  });

  test("adds a todo in place from the server's row and re-arms the form", async () => {
    load();
    const added: Todo = {
      id: 4,
      title: "Delta",
      completed_at: null,
      created_by: null,
    };
    responses.push(new Response(rowHtml(added), { status: 201 }));

    const form = document.querySelector<HTMLFormElement>(".todo-form");
    const input = form?.querySelector<HTMLInputElement>("input[name='title']");
    if (!form || !input) throw new Error("No add form");
    input.value = "Delta";
    submit(form);
    await settled();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/todos");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers[FRAGMENT_HEADER]).toBe("1");
    expect(headers[CSRF_HEADER]).toBe("create-token");
    expect((calls[0].init.body as URLSearchParams).get("title")).toBe("Delta");

    expect(visibleTitles()).toEqual(["Alpha", "Beta", "Gamma", "Delta"]);
    expect(count()).toBe("3 items left");
    expect(input.value).toBe("");
    // The new row sits above the empty row, so it stays in the table body order.
    expect(rows()[3].nextElementSibling).toBe(emptyRow());

    // The inserted row is bound: its toggle form posts as a fragment too.
    responses.push(
      new Response(rowHtml({ ...added, completed_at: new Date() })),
    );
    submit(rows()[3].querySelector(".toggle-form"));
    await settled();
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toContain("/todos/4/toggle");
    expect(count()).toBe("2 items left");
  });

  test("toggles a row by swapping in the server's row", async () => {
    load();
    responses.push(
      new Response(rowHtml({ ...seed[0], completed_at: new Date() })),
    );

    submit(rows()[0].querySelector(".toggle-form"));
    await settled();

    const headers = calls[0].init.headers as Record<string, string>;
    expect(calls[0].url).toContain("/todos/1/toggle");
    expect(headers[CSRF_HEADER]).toBe("t1");

    const first = rows()[0];
    expect(first.hasAttribute("data-completed")).toBe(true);
    expect(first.classList.contains("done")).toBe(true);
    expect(
      first.querySelector(".toggle-btn")?.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(count()).toBe("1 item left");

    // The swapped row carries the server's fresh token and is bound again.
    expect(
      first.querySelector<HTMLInputElement>("input[name='_csrf']")?.value,
    ).toBe("fresh-toggle");
    filterButton("Active").click();
    expect(visibleTitles()).toEqual(["Gamma"]);
  });

  test("removes a row on a 204", async () => {
    load(true);
    responses.push(new Response(null, { status: 204 }));

    submit(rows()[1].querySelector(".delete-form"));
    await settled();

    const headers = calls[0].init.headers as Record<string, string>;
    expect(calls[0].url).toContain("/todos/2/delete");
    expect(headers[CSRF_HEADER]).toBe("d2");
    expect(visibleTitles()).toEqual(["Alpha", "Gamma"]);
    expect(count()).toBe("2 items left");
  });

  test("retries once with the fresh token from a 403", async () => {
    load();
    responses.push(
      new Response(null, {
        status: 403,
        headers: { [CSRF_HEADER]: "renewed" },
      }),
      new Response(rowHtml({ ...seed[2], completed_at: new Date() })),
    );

    submit(rows()[2].querySelector(".toggle-form"));
    await settled();

    expect(calls).toHaveLength(2);
    expect((calls[1].init.headers as Record<string, string>)[CSRF_HEADER]).toBe(
      "renewed",
    );
    expect(rows()[2].hasAttribute("data-completed")).toBe(true);
  });

  test("falls back to a plain post when the enhanced request fails", async () => {
    load();
    responses.push(new Response("Not found", { status: 404 }));

    const form = rows()[0].querySelector(".toggle-form");
    if (!(form instanceof HTMLFormElement)) throw new Error("No form");
    const nativeSubmit = mock(() => {});
    form.submit = nativeSubmit;

    submit(form);
    await settled();

    expect(nativeSubmit).toHaveBeenCalledTimes(1);
    expect(rows()[0].hasAttribute("data-completed")).toBe(false);
  });
});
