import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { renderToString } from "preact-render-to-string";
import { ThemeToggle } from "../../server/components/theme-toggle";
import { init, THEME_STORAGE_KEY } from "./theme-toggle";

// The server component is the fixture, so the markup under test is the markup
// that ships — a renamed attribute breaks this file rather than the page.
const markup = `<header>${renderToString(<ThemeToggle />)}</header>`;

const button = () =>
  document.querySelector("[data-theme-toggle]") as HTMLButtonElement;
const visibleIcon = () =>
  (
    document.querySelector(
      "[data-theme-icon]:not([hidden])",
    ) as HTMLElement | null
  )?.dataset.themeIcon;

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  document.body.innerHTML = markup;
});

afterEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  document.body.innerHTML = "";
});

describe("theme toggle", () => {
  test("ships hidden and is revealed only once the script runs", () => {
    expect(button().hidden).toBe(true);
    init();
    expect(button().hidden).toBe(false);
  });

  test("starts on system with no stored preference", () => {
    init();

    expect(visibleIcon()).toBe("system");
    expect(button().getAttribute("aria-label")).toBe("Theme: system");
    // System is the *absence* of the attribute: base.css scopes the OS media
    // query to :root:not([data-theme]).
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  test("cycles system to light to dark and back", () => {
    init();

    button().click();
    expect(visibleIcon()).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");

    button().click();
    expect(visibleIcon()).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");

    button().click();
    expect(visibleIcon()).toBe("system");
    expect(document.documentElement.dataset.theme).toBeUndefined();
    // Back to system clears the key rather than storing "system", so the
    // inline script in layouts.tsx has nothing to apply.
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  test("restores a stored preference", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    init();

    expect(visibleIcon()).toBe("dark");
    expect(button().getAttribute("aria-label")).toBe("Theme: dark");
  });

  test("ignores a stored value that is not a theme", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "chartreuse");
    init();

    expect(visibleIcon()).toBe("system");
  });

  test("the inline pre-paint script reads the same key", async () => {
    const layouts = await Bun.file(
      new URL("../../server/components/layouts.tsx", import.meta.url),
    ).text();

    // Duplicated on purpose — the script has to run before the bundle exists —
    // so the duplication is what gets pinned.
    expect(layouts).toContain(`localStorage.getItem("${THEME_STORAGE_KEY}")`);
  });
});
