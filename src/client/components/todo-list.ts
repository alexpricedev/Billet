import { bind, defineComponent } from "@client/reactive/component";
import { parseFragment, submitForm } from "@client/reactive/request";
import { computed, effect, signal } from "@client/reactive/signal";
import { remainingLabel } from "@shared/todo";

type Filter = "all" | "active" | "completed";

// The classic list, over the server's own table. Every mutation on the page is
// a form that works without JavaScript; this component intercepts the submit,
// asks the server for the row instead of a redirect, and puts the row where
// the form was. State the server owns (done or not) stays in the markup as
// `data-completed`; the component only decides which rows are shown and
// keeps the count.
export const todoList = defineComponent("todo-list", (root) => {
  const tbody = root.querySelector("tbody");
  if (!tbody) throw new Error("todo-list needs a <tbody> to manage");

  const readRows = () =>
    Array.from(tbody.querySelectorAll<HTMLTableRowElement>("tr[data-id]"));
  const isDone = (row: HTMLTableRowElement) =>
    row.hasAttribute("data-completed");

  // Re-read after every insert, swap or removal: the DOM is the source of
  // truth for the rows, the signal is what makes the filter and count follow.
  const rows = signal(readRows());
  const refresh = () => rows.set(readRows());

  const filter = signal<Filter>("all");
  const visible = computed(() =>
    rows.value.filter(
      (row) =>
        filter.value === "all" ||
        (filter.value === "completed") === isDone(row),
    ),
  );
  effect(() => {
    const shown = new Set(visible.value);
    for (const row of rows.value) row.hidden = !shown.has(row);
  });

  const rowFrom = (html: string): HTMLTableRowElement => {
    const row = parseFragment(html, "tbody");
    if (!(row instanceof HTMLTableRowElement)) {
      throw new Error("Expected the server to answer with a table row");
    }
    return row;
  };

  // If the enhanced path fails for any reason — a validation 4xx, a redirect
  // to /login, a dropped connection — let the form post as it would have
  // without us, and the server's redirect-and-flash flow shows what happened.
  const enhance =
    (apply: (form: HTMLFormElement, html: string) => void) =>
    async (event: Event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      event.preventDefault();
      try {
        const html = await submitForm(form);
        apply(form, html);
        refresh();
      } catch {
        form.submit();
      }
    };

  const add = enhance((form, html) => {
    const row = rowFrom(html);
    const emptyRow = tbody.querySelector(".empty-row");
    if (emptyRow) tbody.insertBefore(row, emptyRow);
    else tbody.appendChild(row);
    bind(row);
    form.reset();
    form.querySelector<HTMLInputElement>("input[name='title']")?.focus();
  });

  const toggle = enhance((form, html) => {
    const current = form.closest("tr");
    if (!current) return;
    const next = rowFrom(html);
    current.replaceWith(next);
    bind(next);
  });

  const remove = enhance((form) => {
    form.closest("tr")?.remove();
  });

  return {
    remaining: computed(() =>
      remainingLabel(rows.value.filter((row) => !isDone(row)).length),
    ),
    isEmpty: computed(() => visible.value.length === 0),
    isAll: computed(() => filter.value === "all"),
    isActive: computed(() => filter.value === "active"),
    isCompleted: computed(() => filter.value === "completed"),
    showAll: () => filter.set("all"),
    showActive: () => filter.set("active"),
    showCompleted: () => filter.set("completed"),
    add,
    toggle,
    remove,
  };
});

// The template and the row component import this type only, so the server
// compiles the binding names against the component without loading it.
export type TodoList = typeof todoList;
