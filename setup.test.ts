import { describe, expect, test } from "bun:test";
import { toSlug } from "./setup";

describe("toSlug", () => {
  test("converts display name to kebab-case slug", () => {
    expect(toSlug("My Cool App")).toBe("my-cool-app");
  });

  test("handles single word", () => {
    expect(toSlug("Dashboard")).toBe("dashboard");
  });

  test("trims whitespace", () => {
    expect(toSlug("  My App  ")).toBe("my-app");
  });

  test("collapses multiple spaces", () => {
    expect(toSlug("My   Cool   App")).toBe("my-cool-app");
  });

  test("removes non-alphanumeric characters except spaces", () => {
    expect(toSlug("My App! (v2)")).toBe("my-app-v2");
  });

  test("collapses multiple hyphens", () => {
    expect(toSlug("My -- App")).toBe("my-app");
  });

  test("removes leading and trailing hyphens", () => {
    expect(toSlug("-My App-")).toBe("my-app");
  });
});
