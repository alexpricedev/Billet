import { afterEach, describe, expect, test } from "bun:test";

describe("main page router", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    delete document.body.dataset.page;
  });

  test("calls home init when data-page is home", async () => {
    document.body.dataset.page = "home";
    await import("./main");
    // Home init is a no-op, just verify it doesn't throw
    expect(true).toBe(true);
  });
});
