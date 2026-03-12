/** @jsxImportSource preact */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { render } from "preact";
import { ProjectSearch } from "./project-search";

const projects = [
  { id: 1, title: "Alpha" },
  { id: 2, title: "Beta" },
  { id: 3, title: "Gamma" },
];

describe("ProjectSearch", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);

    const list = document.createElement("div");
    list.id = "projects-list";
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    for (const label of ["Title", "Created by"]) {
      const th = document.createElement("th");
      th.textContent = label;
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    for (const p of projects) {
      const row = document.createElement("tr");
      const td = document.createElement("td");
      td.textContent = p.title;
      row.appendChild(td);
      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    list.appendChild(table);
    document.body.appendChild(list);
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("renders search input", () => {
    render(<ProjectSearch projects={projects} />, container);
    const input = container.querySelector("input");
    expect(input).not.toBeNull();
    if (!input) throw new Error("Input not found");
    expect(input.placeholder).toBe("Search projects...");
  });

  test("always shows count", () => {
    render(<ProjectSearch projects={projects} />, container);
    const countText = container.querySelector(".search-count");
    expect(countText).not.toBeNull();
    if (!countText) throw new Error("Count not found");
    expect(countText.textContent).toContain("Showing 3 of 3");
  });

  test("filters and shows count when query is entered", async () => {
    render(<ProjectSearch projects={projects} />, container);
    const input = container.querySelector("input");
    if (!input) throw new Error("Input not found");

    input.value = "alpha";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    await new Promise((r) => setTimeout(r, 10));

    const countText = container.querySelector(".search-count");
    expect(countText).not.toBeNull();
    if (!countText) throw new Error("Count not found");
    expect(countText.textContent).toContain("Showing 1 of 3");
  });

  test("hides non-matching rows in the server-rendered table", async () => {
    render(<ProjectSearch projects={projects} />, container);
    const input = container.querySelector("input");
    if (!input) throw new Error("Input not found");

    input.value = "beta";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    await new Promise((r) => setTimeout(r, 10));

    const listEl = document.getElementById("projects-list");
    if (!listEl) throw new Error("List not found");
    const rows = listEl.querySelectorAll("tbody tr");
    expect((rows[0] as HTMLElement).hidden).toBe(true);
    expect((rows[1] as HTMLElement).hidden).toBe(false);
    expect((rows[2] as HTMLElement).hidden).toBe(true);
  });

  test("shows all rows when query is cleared", async () => {
    render(<ProjectSearch projects={projects} />, container);
    const input = container.querySelector("input");
    if (!input) throw new Error("Input not found");

    input.value = "beta";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 10));

    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 10));

    const listEl = document.getElementById("projects-list");
    if (!listEl) throw new Error("List not found");
    const rows = listEl.querySelectorAll("tbody tr:not(.empty-row)");
    for (const row of Array.from(rows)) {
      expect((row as HTMLElement).hidden).toBe(false);
    }
  });

  test("shows empty row when no results match", async () => {
    render(<ProjectSearch projects={projects} />, container);
    const input = container.querySelector("input");
    if (!input) throw new Error("Input not found");

    input.value = "zzz";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    await new Promise((r) => setTimeout(r, 10));

    const listEl = document.getElementById("projects-list");
    if (!listEl) throw new Error("List not found");
    const emptyRow = listEl.querySelector(".empty-row") as HTMLElement;
    expect(emptyRow).not.toBeNull();
    expect(emptyRow.hidden).toBe(false);
    expect(emptyRow.textContent).toContain("No matching projects found.");
  });

  test("hides empty row when results match again", async () => {
    render(<ProjectSearch projects={projects} />, container);
    const input = container.querySelector("input");
    if (!input) throw new Error("Input not found");

    input.value = "zzz";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 10));

    input.value = "alpha";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 10));

    const listEl = document.getElementById("projects-list");
    if (!listEl) throw new Error("List not found");
    const emptyRow = listEl.querySelector(".empty-row") as HTMLElement;
    expect(emptyRow).not.toBeNull();
    expect(emptyRow.hidden).toBe(true);
  });
});
