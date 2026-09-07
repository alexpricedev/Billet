import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mount, registerComponent } from "@client/reactive/component";
import { Projects } from "@server/templates/projects";
import { renderToString } from "preact-render-to-string";
import { projectSearch } from "./project-search";

// The fixture is the real template, not a hand-copied fragment: the component
// binds to whatever `projects.tsx` renders, so drift between the two would fail
// here rather than in the browser. The page is parsed into a <template>, whose
// content is inert, and only <main> goes into the document — anywhere live,
// happy-dom would try to fetch the layout's stylesheet and bundle.
const mainOf = (html: string): string => {
  const template = document.createElement("template");
  template.innerHTML = html;
  const main = template.content.querySelector("main");
  if (!main) throw new Error("Template rendered no <main>");
  return main.innerHTML;
};

const page = renderToString(
  <Projects
    projects={[
      { id: 1, title: "Alpha", created_by: null },
      { id: 2, title: "Beta", created_by: "someone@example.com" },
      { id: 3, title: "Gamma", created_by: null },
    ]}
    state={{}}
    isAuthenticated={false}
    createCsrfToken="token"
    deleteCsrfTokens={{}}
    user={null}
  />,
);

registerComponent(projectSearch);

const searchInput = (): HTMLInputElement => {
  const el = document.getElementById("project-search-input");
  if (!(el instanceof HTMLInputElement)) throw new Error("No search input");
  return el;
};

const projectRows = (): HTMLTableRowElement[] =>
  Array.from(
    document.querySelectorAll<HTMLTableRowElement>(
      "#projects-list tbody tr:not(.empty-row)",
    ),
  );

const emptyRow = (): HTMLTableRowElement => {
  const el = document.querySelector(".empty-row");
  if (!(el instanceof HTMLTableRowElement)) throw new Error("No empty row");
  return el;
};

const type = (value: string) => {
  const input = searchInput();
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

describe("project search", () => {
  let unmount: () => void;

  beforeEach(() => {
    document.body.innerHTML = mainOf(page);
    unmount = mount();
  });

  afterEach(() => {
    unmount();
    document.body.innerHTML = "";
  });

  test("the template renders the component root the client registers", () => {
    const root = document.querySelector(
      `[data-component="${projectSearch.name}"]`,
    );
    expect(root).not.toBeNull();
    expect(root?.hasAttribute("data-mounted")).toBe(true);
  });

  test("starts with every row visible and the full count", () => {
    expect(projectRows().every((row) => !row.hidden)).toBe(true);
    expect(document.querySelector(".search-count")?.textContent).toBe(
      "Showing 3 of 3",
    );
    expect(emptyRow().hidden).toBe(true);
  });

  test("hides rows whose title doesn't match, case-insensitively", () => {
    type("BETA");

    expect(projectRows().map((row) => row.hidden)).toEqual([true, false, true]);
    expect(document.querySelector(".search-count")?.textContent).toBe(
      "Showing 1 of 3",
    );
  });

  test("matches on the title, not the whole row", () => {
    // Every row says "Guest" or "User" in its second cell.
    type("guest");
    expect(projectRows().every((row) => row.hidden)).toBe(true);
  });

  test("shows the empty row when nothing matches, and hides it again", () => {
    type("zzz");
    expect(emptyRow().hidden).toBe(false);
    expect(emptyRow().textContent).toContain("No matching projects found.");
    expect(document.querySelector(".search-count")?.textContent).toBe(
      "Showing 0 of 3",
    );

    type("alpha");
    expect(emptyRow().hidden).toBe(true);
  });

  test("clearing the query restores every row", () => {
    type("beta");
    type("");
    expect(projectRows().every((row) => !row.hidden)).toBe(true);
  });
});

describe("project search without projects", () => {
  test("renders no search box, and mounting is harmless", () => {
    const empty = renderToString(
      <Projects
        projects={[]}
        state={{}}
        isAuthenticated={false}
        createCsrfToken="token"
        deleteCsrfTokens={{}}
        user={null}
      />,
    );
    document.body.innerHTML = mainOf(empty);

    const unmount = mount();
    expect(document.getElementById("project-search-input")).toBeNull();
    expect(document.body.textContent).toContain("No projects yet.");
    unmount();
    document.body.innerHTML = "";
  });
});
