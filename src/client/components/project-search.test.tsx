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
    for (const p of projects) {
      const card = document.createElement("div");
      card.textContent = p.title;
      list.appendChild(card);
    }
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

  test("does not show count when query is empty", () => {
    render(<ProjectSearch projects={projects} />, container);
    const countText = container.querySelector("p");
    expect(countText).toBeNull();
  });

  test("filters and shows count when query is entered", async () => {
    render(<ProjectSearch projects={projects} />, container);
    const input = container.querySelector("input");
    if (!input) throw new Error("Input not found");

    input.value = "alpha";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    await new Promise((r) => setTimeout(r, 10));

    const countText = container.querySelector("p");
    expect(countText).not.toBeNull();
    if (!countText) throw new Error("Count text not found");
    expect(countText.textContent).toContain("Showing 1 of 3");
  });

  test("hides non-matching cards in the server-rendered list", async () => {
    render(<ProjectSearch projects={projects} />, container);
    const input = container.querySelector("input");
    if (!input) throw new Error("Input not found");

    input.value = "beta";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    await new Promise((r) => setTimeout(r, 10));

    const listEl = document.getElementById("projects-list");
    if (!listEl) throw new Error("List not found");
    const cards = listEl.children;
    expect((cards[0] as HTMLElement).hidden).toBe(true);
    expect((cards[1] as HTMLElement).hidden).toBe(false);
    expect((cards[2] as HTMLElement).hidden).toBe(true);
  });

  test("shows all cards when query is cleared", async () => {
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
    const cards = listEl.children;
    for (const card of Array.from(cards)) {
      expect((card as HTMLElement).hidden).toBe(false);
    }
  });
});
