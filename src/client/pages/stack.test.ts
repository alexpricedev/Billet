import { describe, expect, test } from "bun:test";
import { init } from "./stack";

describe("stack page init", () => {
  test("does not throw", () => {
    expect(() => init()).not.toThrow();
  });
});
