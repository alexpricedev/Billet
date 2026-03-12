import { describe, expect, test } from "bun:test";
import { buildReadme, generateEnvContent, isValidDbUrl, toSlug } from "./setup";

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

describe("buildReadme", () => {
  const readmeContent = Bun.file("README.md").text();

  test("starts with project name as h1", async () => {
    const result = buildReadme(await readmeContent, "My Cool App", "my-cool-app");
    expect(result.startsWith("# My Cool App\n")).toBe(true);
  });

  test("removes the logo and badges", async () => {
    const result = buildReadme(await readmeContent, "My Cool App", "my-cool-app");
    expect(result).not.toContain("img src=");
    expect(result).not.toContain("shields.io");
  });

  test("removes the Why Billet section", async () => {
    const result = buildReadme(await readmeContent, "My Cool App", "my-cool-app");
    expect(result).not.toContain("## Why");
    expect(result).not.toContain("Sheffield");
    expect(result).not.toContain("backpressure");
  });

  test("removes the Built for AI Agents section", async () => {
    const result = buildReadme(await readmeContent, "My Cool App", "my-cool-app");
    expect(result).not.toContain("## Built for AI Agents");
    expect(result).not.toContain("feedback stack");
  });

  test("removes the GitHub template link", async () => {
    const result = buildReadme(await readmeContent, "My Cool App", "my-cool-app");
    expect(result).not.toContain("github.com/new?template_name");
    expect(result).not.toContain("alexpricedev");
  });

  test("removes the Sheffield footer", async () => {
    const result = buildReadme(await readmeContent, "My Cool App", "my-cool-app");
    expect(result).not.toContain("Sheffield");
    expect(result).not.toContain("Made with");
  });

  test("keeps What's Included section", async () => {
    const result = buildReadme(await readmeContent, "My Cool App", "my-cool-app");
    expect(result).toContain("## What's Included");
    expect(result).toContain("### Authentication");
  });

  test("keeps Project Structure section", async () => {
    const result = buildReadme(await readmeContent, "My Cool App", "my-cool-app");
    expect(result).toContain("## Project Structure");
  });

  test("keeps Deploy section with Billet replaced", async () => {
    const result = buildReadme(await readmeContent, "My Cool App", "my-cool-app");
    expect(result).toContain("## Deploy");
    expect(result).not.toContain("Billet is a single");
    expect(result).toContain("My Cool App is a single");
  });

  test("keeps License section", async () => {
    const result = buildReadme(await readmeContent, "My Cool App", "my-cool-app");
    expect(result).toContain("## License");
  });

  test("has updated Quick Start referencing bun run setup", async () => {
    const result = buildReadme(await readmeContent, "My Cool App", "my-cool-app");
    expect(result).toContain("bun run setup");
    expect(result).not.toContain("cp .env.example .env");
    expect(result).not.toContain("generate:pepper");
  });

  test("replaces remaining Billet references with display name", async () => {
    const result = buildReadme(await readmeContent, "My Cool App", "my-cool-app");
    expect(result).not.toContain("Billet");
  });
});
