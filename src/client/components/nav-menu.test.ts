import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { init } from "./nav-menu";

const markup = `
  <header>
    <a class="logo" href="/">Billet</a>
    <nav data-component="nav" aria-label="Main navigation">
      <button type="button" class="nav-toggle" aria-expanded="false" aria-controls="nav-menu" hidden>
        <span class="sr-only">Menu</span>
      </button>
      <div id="nav-menu" class="nav-panel">
        <ul>
          <li><a href="/stack">Stack</a></li>
        </ul>
        <div class="nav-auth"><a class="btn-ghost" href="/login">Login</a></div>
      </div>
    </nav>
  </header>
  <main><p id="outside">body</p></main>
`;

const nav = () =>
  document.querySelector('[data-component="nav"]') as HTMLElement;
const toggle = () => document.querySelector(".nav-toggle") as HTMLButtonElement;

const isOpen = () =>
  nav().dataset.open !== undefined &&
  toggle().getAttribute("aria-expanded") === "true";

describe("nav menu", () => {
  beforeEach(() => {
    document.body.innerHTML = markup;
    init();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("reveals the toggle and marks the nav as enhanced", () => {
    expect(toggle().hidden).toBe(false);
    expect(nav().dataset.navEnhanced).toBe("");
  });

  test("opens and closes on click", () => {
    toggle().click();
    expect(isOpen()).toBe(true);

    toggle().click();
    expect(isOpen()).toBe(false);
  });

  test("closes on Escape and hands focus back to the toggle", () => {
    toggle().click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(isOpen()).toBe(false);
    expect(document.activeElement).toBe(toggle());
  });

  test("closes when the click lands outside the nav", () => {
    toggle().click();
    document.getElementById("outside")?.click();

    expect(isOpen()).toBe(false);
  });

  test("leaves focus alone when it closes without a keypress", () => {
    toggle().click();
    document.getElementById("outside")?.click();

    // Only Escape returns focus — stealing it on an unrelated click would yank
    // the user out of whatever they were reaching for.
    expect(document.activeElement).not.toBe(toggle());
  });
});

describe("nav menu without a nav", () => {
  test("does nothing on a page that renders no nav", () => {
    document.body.innerHTML = "<main></main>";
    expect(() => init()).not.toThrow();
  });
});
