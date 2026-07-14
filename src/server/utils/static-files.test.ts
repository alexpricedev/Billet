import { describe, expect, test } from "bun:test";
import { createBunRequest } from "../test-utils/bun-request";
import { etagMatches, fileEtag, serveFile } from "./static-files";

// A real file on disk so size/mtime (and thus the ETag) are stable within a run.
const FIXTURE = Bun.file("public/logo.svg");

describe("fileEtag", () => {
  test("produces a weak validator from size and mtime", () => {
    const etag = fileEtag(FIXTURE);
    expect(etag).toMatch(/^W\/"[0-9a-f]+-[0-9a-f]+"$/);
  });

  test("is stable for the same file", () => {
    expect(fileEtag(FIXTURE)).toBe(fileEtag(FIXTURE));
  });
});

describe("etagMatches", () => {
  const etag = 'W/"abc-def"';

  test("returns false when the header is absent", () => {
    expect(etagMatches(null, etag)).toBe(false);
  });

  test("matches an exact echoed token", () => {
    expect(etagMatches(etag, etag)).toBe(true);
  });

  test("matches within a comma-separated list", () => {
    expect(etagMatches(`W/"other", ${etag}`, etag)).toBe(true);
  });

  test("matches the wildcard", () => {
    expect(etagMatches("*", etag)).toBe(true);
  });

  test("does not match a different validator", () => {
    expect(etagMatches('W/"nope"', etag)).toBe(false);
  });
});

describe("serveFile", () => {
  const get = (headers: Record<string, string> = {}) =>
    createBunRequest("http://localhost:3000/logo.svg", { headers });

  test("serves the file with type, caching headers, and a validator", async () => {
    const res = serveFile(get(), FIXTURE);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(res.headers.get("Cache-Control")).toContain("max-age=3600");
    expect(res.headers.get("Cache-Control")).toContain(
      "stale-while-revalidate",
    );
    expect(res.headers.get("ETag")).toBe(fileEtag(FIXTURE));
    expect(res.headers.get("Last-Modified")).toBeTruthy();
    expect((await res.text()).length).toBeGreaterThan(0);
  });

  test("returns an empty 304 when the client's validator still matches", async () => {
    const etag = fileEtag(FIXTURE);
    const res = serveFile(get({ "If-None-Match": etag }), FIXTURE);

    expect(res.status).toBe(304);
    expect(res.headers.get("ETag")).toBe(etag);
    expect(res.headers.get("Cache-Control")).toContain("max-age=3600");
    expect(await res.text()).toBe("");
  });

  test("serves 200 when the client's validator is stale", async () => {
    const res = serveFile(get({ "If-None-Match": 'W/"stale"' }), FIXTURE);

    expect(res.status).toBe(200);
    expect((await res.text()).length).toBeGreaterThan(0);
  });
});
