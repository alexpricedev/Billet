import { describe, expect, test } from "bun:test";
import { render404, render500, render503 } from "./errors";

describe("error responses", () => {
  test("render404 returns a 404 HTML page with a way forward and no leaks", async () => {
    const res = render404();
    const body = await res.text();

    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(body).toContain("<!DOCTYPE html>");
    expect(body).toContain("Page not found");
    expect(body).toContain('href="/"');
    // noindex so search engines never treat the error body as real content.
    expect(body).toContain("noindex");
  });

  test("render500 returns a 500 HTML page with a generic, non-leaky message", async () => {
    const res = render500();
    const body = await res.text();

    expect(res.status).toBe(500);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(body).toContain("Something went wrong");
  });

  test("render503 returns a 503 with Retry-After and no home/nav affordances", async () => {
    const res = render503(1800);
    const body = await res.text();

    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("1800");
    expect(body).toContain("be right back");
    // The site is intentionally offline, so no "back to homepage" button.
    expect(body).not.toContain("Back to homepage");
  });
});
