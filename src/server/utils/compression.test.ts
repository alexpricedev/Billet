import { describe, expect, test } from "bun:test";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { createBunRequest } from "../test-utils/bun-request";
import { withCompression } from "./compression";

// A body comfortably over the 1KB minimum so compression actually engages.
const LARGE_HTML = `<!doctype html><html><body>${"<p>hello world</p>".repeat(200)}</body></html>`;

const brReq = (encoding = "br, gzip") =>
  createBunRequest("http://localhost:3000/", {
    headers: { "Accept-Encoding": encoding },
  });

describe("withCompression", () => {
  test("brotli-compresses a large text/html body when br is accepted", async () => {
    const res = await withCompression(
      brReq("br, gzip"),
      new Response(LARGE_HTML, { headers: { "Content-Type": "text/html" } }),
    );

    expect(res.headers.get("Content-Encoding")).toBe("br");
    expect(res.headers.get("Vary")).toBe("Accept-Encoding");

    const raw = new Uint8Array(await res.arrayBuffer());
    expect(raw.byteLength).toBeLessThan(LARGE_HTML.length);
    expect(new TextDecoder().decode(brotliDecompressSync(raw))).toBe(
      LARGE_HTML,
    );
  });

  test("falls back to gzip when brotli is not accepted", async () => {
    const res = await withCompression(
      brReq("gzip"),
      new Response(LARGE_HTML, { headers: { "Content-Type": "text/html" } }),
    );

    expect(res.headers.get("Content-Encoding")).toBe("gzip");
    const raw = new Uint8Array(await res.arrayBuffer());
    expect(new TextDecoder().decode(gunzipSync(raw))).toBe(LARGE_HTML);
  });

  test("compresses CSS and JS content types", async () => {
    for (const type of [
      "text/css",
      "text/javascript",
      "application/javascript",
      "application/json",
      "image/svg+xml",
    ]) {
      const res = await withCompression(
        brReq(),
        new Response(LARGE_HTML, { headers: { "Content-Type": type } }),
      );
      expect(res.headers.get("Content-Encoding")).toBe("br");
    }
  });

  test("leaves the body untouched when the client accepts no known encoding", async () => {
    const res = await withCompression(
      brReq("identity"),
      new Response(LARGE_HTML, { headers: { "Content-Type": "text/html" } }),
    );

    expect(res.headers.has("Content-Encoding")).toBe(false);
    expect(await res.text()).toBe(LARGE_HTML);
  });

  test("does not compress already-compressed media", async () => {
    const res = await withCompression(
      brReq(),
      new Response("x".repeat(5000), {
        headers: { "Content-Type": "image/png" },
      }),
    );

    expect(res.headers.has("Content-Encoding")).toBe(false);
  });

  test("skips bodies below the minimum size", async () => {
    const res = await withCompression(
      brReq(),
      new Response("tiny", { headers: { "Content-Type": "text/html" } }),
    );

    expect(res.headers.has("Content-Encoding")).toBe(false);
    expect(await res.text()).toBe("tiny");
  });

  test("does not double-encode a response that already set Content-Encoding", async () => {
    const res = await withCompression(
      brReq(),
      new Response(LARGE_HTML, {
        headers: { "Content-Type": "text/html", "Content-Encoding": "gzip" },
      }),
    );

    expect(res.headers.get("Content-Encoding")).toBe("gzip");
  });

  test("does not compress 304 Not Modified responses", async () => {
    const res = await withCompression(
      brReq(),
      new Response(null, {
        status: 304,
        headers: { "Content-Type": "text/html" },
      }),
    );

    expect(res.status).toBe(304);
    expect(res.headers.has("Content-Encoding")).toBe(false);
  });

  test("appends Accept-Encoding to an existing Vary without clobbering it", async () => {
    const res = await withCompression(
      brReq(),
      new Response(LARGE_HTML, {
        headers: { "Content-Type": "text/html", Vary: "Cookie" },
      }),
    );

    const vary = res.headers.get("Vary") ?? "";
    expect(vary).toContain("Cookie");
    expect(vary).toContain("Accept-Encoding");
  });
});
