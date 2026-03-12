import { describe, expect, test } from "bun:test";
import { init } from "./home";

describe("home page init", () => {
  test("does not throw", () => {
    expect(() => init()).not.toThrow();
  });
});
