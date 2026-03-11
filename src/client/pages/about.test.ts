import { afterEach, describe, expect, test } from "bun:test";
import { init } from "./about";

describe("about page init", () => {
  afterEach(() => {
    document.body.style.backgroundColor = "";
  });

  test("sets body background colour", () => {
    init();
    expect(document.body.style.backgroundColor).toBe("#fef8e7");
  });
});
