import { describe, expect, test } from "bun:test";
import { generateEnvContent, isValidDbUrl, toSlug } from "./setup";

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

describe("generateEnvContent", () => {
  test("generates .env content with all three vars", () => {
    const result = generateEnvContent("postgresql://localhost/mydb", "abc123");
    expect(result).toContain("DATABASE_URL=postgresql://localhost/mydb");
    expect(result).toContain("CRYPTO_PEPPER=abc123");
    expect(result).toContain("APP_URL=http://localhost");
  });
  test("does not include APP_ORIGIN", () => {
    const result = generateEnvContent("postgresql://localhost/mydb", "abc123");
    expect(result).not.toContain("APP_ORIGIN");
  });
  test("each var is on its own line", () => {
    const result = generateEnvContent("postgresql://localhost/mydb", "abc123");
    const lines = result.trim().split("\n");
    expect(lines.length).toBe(3);
  });
});
