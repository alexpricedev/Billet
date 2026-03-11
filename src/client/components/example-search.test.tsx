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
    if (!input) throw new Error("Input not found");
    expect(input.placeholder).toBe("Search examples...");
  });

  test("does not show count when query is empty", () => {
    render(<ExampleSearch examples={examples} />, container);
    const countText = container.querySelector("p");
    expect(countText).toBeNull();
  });

  test("filters and shows count when query is entered", async () => {
    render(<ExampleSearch examples={examples} />, container);
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
    render(<ExampleSearch examples={examples} />, container);
    const input = container.querySelector("input");
    if (!input) throw new Error("Input not found");

    input.value = "beta";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    await new Promise((r) => setTimeout(r, 10));

    const listEl = document.getElementById("examples-list");
    if (!listEl) throw new Error("List not found");
    const cards = listEl.children;
    expect((cards[0] as HTMLElement).hidden).toBe(true);
    expect((cards[1] as HTMLElement).hidden).toBe(false);
    expect((cards[2] as HTMLElement).hidden).toBe(true);
  });

  test("shows all cards when query is cleared", async () => {
    render(<ExampleSearch examples={examples} />, container);
    const input = container.querySelector("input");
    if (!input) throw new Error("Input not found");

    input.value = "beta";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 10));

    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 10));

    const listEl = document.getElementById("examples-list");
    if (!listEl) throw new Error("List not found");
    const cards = listEl.children;
    for (const card of Array.from(cards)) {
      expect((card as HTMLElement).hidden).toBe(false);
    }
  });
});
