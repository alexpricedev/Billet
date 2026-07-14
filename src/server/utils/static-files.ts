// Serving of static files from disk (public/ assets and the un-hashed dev
// bundle). Sets an explicit Content-Type, revalidatable caching headers, and a
// validator, and answers conditional requests with a 304. Fingerprinted bundles
// take the immutable path in services/assets.ts instead.

// public/ assets (favicons, og-image, cube.json) are not
// fingerprinted, so they revalidate rather than caching forever: a short max-age
// with stale-while-revalidate/stale-if-error for resilience under load or origin
// errors.
const STATIC_CACHE_CONTROL =
  "public, max-age=3600, stale-while-revalidate=86400, stale-if-error=604800";

// Weak validator from size + mtime — cheap (no content hash) and stable across
// identical bytes. Weak is correct here: it also matches the compressed variant,
// which shares the underlying file (compression happens downstream).
export const fileEtag = (file: Bun.BunFile): string =>
  `W/"${file.size.toString(16)}-${file.lastModified.toString(16)}"`;

// A conditional request whose validator still matches gets an empty 304. Browsers
// echo the exact ETag we sent (weak comparison), so a token match is sufficient;
// `*` matches any current representation.
export const etagMatches = (
  ifNoneMatch: string | null,
  etag: string,
): boolean => {
  if (!ifNoneMatch) return false;
  if (ifNoneMatch.trim() === "*") return true;
  return ifNoneMatch.split(",").some((token) => token.trim() === etag);
};

// Serve a static file with its Content-Type, caching headers, and a validator.
// Content-Type is set explicitly because Bun infers it only at native
// serialization time — invisible to the JS `Headers` the compression middleware
// inspects — which also lets text assets (SVG, JSON, webmanifest) compress.
export const serveFile = (req: Request, file: Bun.BunFile): Response => {
  const etag = fileEtag(file);
  const headers: Record<string, string> = {
    "Content-Type": file.type,
    "Cache-Control": STATIC_CACHE_CONTROL,
    ETag: etag,
    "Last-Modified": new Date(file.lastModified).toUTCString(),
  };

  if (etagMatches(req.headers.get("If-None-Match"), etag)) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(file, { headers });
};
