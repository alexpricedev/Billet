import { afterEach, beforeEach, describe, expect, test } from "bun:test";

describe("main page router", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <button id="counter">Click me</button>
      <span id="count">0</span>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = "";
    delete document.body.dataset.page;
  });

  test("calls home init when data-page is home", async () => {
    document.body.dataset.page = "home";
    await import("./main");

    const button = document.getElementById("counter");
    const display = document.getElementById("count");

    if (!button || !display) throw new Error("Elements not found");

    button.click();
    expect(display.textContent).toBe("1");
  });
});
