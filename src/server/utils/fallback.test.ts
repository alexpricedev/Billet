import { describe, expect, test } from "bun:test";
import { handleFallback } from "./fallback";

const req = (path: string) =>
  handleFallback(new Request(`http://localhost:3000${path}`));

describe("handleFallback", () => {
  test("308-redirects a trailing slash to the canonical path, keeping the query", async () => {
    const res = await req("/stack/?ref=x");

    expect(res.status).toBe(308);
    expect(res.headers.get("Location")).toBe("/stack?ref=x");
  });

  test("does not redirect the root path", async () => {
    const res = await req("/");
    expect(res.status).not.toBe(308);
  });

  test("answers the health check without touching the DB", async () => {
    const res = await req("/health");

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  test("serves an existing public/ file with caching headers", async () => {
    const res = await req("/logo.svg");

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(res.headers.get("ETag")).toBeTruthy();
  });

  test("returns 404 for a missing asset under /assets/", async () => {
    const res = await req("/assets/does-not-exist.js");

    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Asset not found");
  });

  test("returns 404 for an unknown path", async () => {
    const res = await req("/nope/not-a-real-file.txt");

    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
  });
});
