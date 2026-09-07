import { defineComponent } from "@client/reactive/component";
import { computed, effect, signal } from "@client/reactive/signal";

// Filters the server-rendered project table as you type. The rows are the
// template's own — nothing here is created, only shown or hidden — so the page
// without JavaScript is the same table with the search box left hidden (see
// projects.css). `data-mounted` on the root is what reveals it.
export const projectSearch = defineComponent("project-search", (root) => {
  const rows = Array.from(
    root.querySelectorAll<HTMLTableRowElement>("tbody tr:not(.empty-row)"),
  );
  const titleOf = (row: HTMLTableRowElement) =>
    (row.querySelector("td")?.textContent ?? "").toLowerCase();

  const query = signal("");
  const matches = computed(() => {
    const needle = query.value.trim().toLowerCase();
    return needle ? rows.filter((row) => titleOf(row).includes(needle)) : rows;
  });

  effect(() => {
    const visible = new Set(matches.value);
    for (const row of rows) row.hidden = !visible.has(row);
  });

  return {
    query,
    summary: computed(
      () => `Showing ${matches.value.length} of ${rows.length}`,
    ),
    noMatches: computed(() => matches.value.length === 0),
  };
});

// The template imports this type only, so the server compiles the binding
// names against the component without loading it.
export type ProjectSearch = typeof projectSearch;
