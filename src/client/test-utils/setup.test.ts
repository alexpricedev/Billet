import { describe, expect, test } from "bun:test";

describe("happy-dom prelude", () => {
  test("document is available globally", () => {
    expect(document).toBeDefined();
    expect(document.createElement).toBeInstanceOf(Function);
  });

  test("window is available globally", () => {
    expect(window).toBeDefined();
    expect(window.location.href).toBe("http://localhost:3000/");
  });
});
