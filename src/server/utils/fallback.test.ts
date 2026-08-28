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

  test("returns 404 for a path that was never one of our assets", async () => {
    const res = await req("/assets/does-not-exist.js");

    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Asset not found");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  test("returns 503 for one of our own bundles that is not built", async () => {
    const built = Bun.file("dist/assets/main.css");
    const restore = (await built.exists()) ? await built.bytes() : null;
    if (restore) await built.delete();

    const res = await req("/assets/main.css");

    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("1");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.text()).toContain("bun run build");

    if (restore) await Bun.write("dist/assets/main.css", restore);
  });

  test("returns a styled HTML 404 page for an unknown path", async () => {
    const res = await req("/nope/not-a-real-file");

    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("Page not found");
    // No implementation detail leaks and the page offers a way forward.
    expect(body).toContain('href="/"');
  });
});
