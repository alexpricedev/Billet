import { describe, expect, test } from "bun:test";
import { isValidDbUrl, toSlug } from "./setup";

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

describe("isValidDbUrl", () => {
  test("accepts postgresql:// URLs", () => {
    expect(isValidDbUrl("postgresql://user:pass@localhost:5432/mydb")).toBe(true);
  });
  test("accepts postgres:// URLs", () => {
    expect(isValidDbUrl("postgres://user:pass@localhost:5432/mydb")).toBe(true);
  });
  test("rejects empty string", () => {
    expect(isValidDbUrl("")).toBe(false);
  });
  test("rejects non-postgres URLs", () => {
    expect(isValidDbUrl("mysql://localhost/mydb")).toBe(false);
  });
  test("rejects random text", () => {
    expect(isValidDbUrl("not a url")).toBe(false);
  });
});
