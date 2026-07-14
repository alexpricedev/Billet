import { brotliCompressSync, constants, gzipSync } from "node:zlib";

// Response compression, negotiated per request. Applied centrally alongside the
// security headers (see `secureRoutes` and the `fetch` fallback in main.ts) so
// every text response — HTML, CSS, JS, JSON, SVG — ships compressed without
// each route opting in. Bun.serve does not compress automatically.
//
// Brotli is preferred (better ratio) with gzip as the fallback; both use the
// mid-range quality the spec recommends for on-the-fly (non-precompressed)
// responses. Already-compressed media (images, video, woff2) is never touched —
// it is excluded by content type rather than re-compressed.

// Content types worth compressing: text and text-like payloads. Everything else
// (image/*, video/*, font/woff2, application/zip, …) is already compressed and
// would only grow. Matched against the type sans parameters (charset).
const COMPRESSIBLE_TYPES = new Set([
  "text/html",
  "text/css",
  "text/plain",
  "text/xml",
  "text/markdown",
  "text/csv",
  "text/javascript",
  "application/javascript",
  "application/json",
  "application/ld+json",
  "application/xml",
  "application/rss+xml",
  "application/manifest+json",
  "image/svg+xml",
]);

// Below this size the compressed output (plus framing overhead) rarely beats the
// original, and the round trip through the compressor is pure cost. One TCP
// segment is ~1.5KB; anything under this fits in the first packet regardless.
const MIN_COMPRESS_BYTES = 1024;

// Dynamic (per-request) compression: mid-range levels, as the spec recommends.
// Max levels (brotli 11 / gzip 9) belong on assets pre-compressed at build time.
const BROTLI_QUALITY = 5;
const GZIP_LEVEL = 6;

const compressibleType = (contentType: string | null): boolean => {
  if (!contentType) return false;
  const type = contentType.split(";", 1)[0].trim().toLowerCase();
  return COMPRESSIBLE_TYPES.has(type);
};

// Pick the best encoding the client accepts. Deliberately simple: we honour the
// presence of a token, not q-values, which is sufficient for br/gzip in every
// real browser. Brotli wins when offered.
const negotiateEncoding = (
  acceptEncoding: string | null,
): "br" | "gzip" | null => {
  if (!acceptEncoding) return null;
  const accepted = acceptEncoding.toLowerCase();
  if (accepted.includes("br")) return "br";
  if (accepted.includes("gzip")) return "gzip";
  return null;
};

// Add Accept-Encoding to Vary without clobbering or duplicating an existing
// value — the response varies by encoding, so shared caches must key on it.
const addEncodingVary = (headers: Headers): void => {
  const existing = headers.get("Vary");
  if (!existing) {
    headers.set("Vary", "Accept-Encoding");
    return;
  }
  if (!existing.toLowerCase().includes("accept-encoding")) {
    headers.set("Vary", `${existing}, Accept-Encoding`);
  }
};

// Compress a response body in place if the client accepts it, the content type
// is text-like, and the payload is large enough to benefit. Returns the original
// response untouched when compression does not apply. Consuming the body means
// we always return a fresh Response once we have read it.
export const withCompression = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  // Nothing to compress, or a variant that must not be rewritten.
  if (res.body === null) return res;
  if (res.headers.has("Content-Encoding")) return res;
  if (res.status === 204 || res.status === 304) return res;
  // A HEAD response carries the headers of its GET but no body to encode.
  if (req.method === "HEAD") return res;
  if (!compressibleType(res.headers.get("Content-Type"))) return res;

  const encoding = negotiateEncoding(req.headers.get("Accept-Encoding"));
  if (!encoding) return res;

  const bytes = new Uint8Array(await res.arrayBuffer());

  // Rebuild the response either way: the body has now been consumed.
  const headers = new Headers(res.headers);
  headers.delete("Content-Length"); // recomputed from the new body by Bun

  if (bytes.byteLength < MIN_COMPRESS_BYTES) {
    return new Response(bytes, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  }

  const buffer =
    encoding === "br"
      ? brotliCompressSync(bytes, {
          params: { [constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY },
        })
      : gzipSync(bytes, { level: GZIP_LEVEL });
  // node:zlib returns a Buffer (ArrayBufferLike-backed, which Response's typed
  // BodyInit rejects); copy into a plain ArrayBuffer-backed Uint8Array.
  const compressed = Uint8Array.from(buffer);

  headers.set("Content-Encoding", encoding);
  addEncodingVary(headers);

  return new Response(compressed, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
};
