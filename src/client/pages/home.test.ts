import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { init } from "./home";

describe("home page init", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <button id="counter">Click me</button>
      <span id="count">0</span>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("increments count on button click", () => {
    init();

    const button = document.getElementById("counter");
    const display = document.getElementById("count");

    if (!button || !display) {
      throw new Error("Elements not found");
    }

    button.click();
    expect(display.textContent).toBe("1");

    button.click();
    expect(display.textContent).toBe("2");
  });

  test("does nothing when elements are missing", () => {
    document.body.innerHTML = "";
    init();
  });
});
