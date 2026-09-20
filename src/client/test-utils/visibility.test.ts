import { describe, expect, test } from "bun:test";
import { isHidden, isShown } from "./visibility";

describe("visibility helpers", () => {
  const el = (html: string): HTMLElement => {
    const holder = document.createElement("div");
    holder.innerHTML = html;
    const first = holder.firstElementChild;
    if (!(first instanceof HTMLElement)) throw new Error("no element");
    return first;
  };

  test("a plain element is shown", () => {
    expect(isShown(el("<p>hi</p>"))).toBe(true);
    expect(isHidden(el("<p>hi</p>"))).toBe(false);
  });

  test("both halves of data-show together mean hidden", () => {
    const p = el("<p hidden style='display: none'>hi</p>");
    expect(isHidden(p)).toBe(true);
    expect(isShown(p)).toBe(false);
  });

  // The regression these exist to catch: `hidden` on its own loses to any
  // author `display:` rule, so a test asserting only `.hidden` would pass
  // while the element was plainly visible on the page.
  test("hidden without the inline display is not treated as hidden", () => {
    const p = el("<p hidden>hi</p>");
    expect(isHidden(p)).toBe(false);
    expect(isShown(p)).toBe(false);
  });

  test("nothing is neither shown nor hidden", () => {
    expect(isShown(null)).toBe(false);
    expect(isHidden(undefined)).toBe(false);
  });
});
