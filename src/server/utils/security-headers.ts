import type { BunRequest } from "bun";
import { withCompression } from "./compression";

// Single source of truth for the security headers sent on every response —
// HTML, JSON, redirects, static files, and errors alike. Applied centrally
// (see `secureRoutes` and the `fetch` fallback in main.ts) rather than per
// route, so no response path can accidentally ship without them.

const isProduction = process.env.NODE_ENV === "production";

// Content Security Policy. Enforcing, but deliberately host-allowlist based
// rather than nonce + 'strict-dynamic': the page ships an inline importmap and
// inline JSON-LD, and pulls Preact from esm.sh and lottie from unpkg. Those
// inline blocks force 'unsafe-inline' here. The real wins this still buys:
// frame-ancestors (clickjacking), object-src/base-uri lockdown, a tight source
// allowlist, and upgrade-insecure-requests. Hardening to nonce + 'strict-dynamic'
// (which lets us drop 'unsafe-inline') is the documented follow-up.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "img-src 'self' data:",
  "font-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline' https://unpkg.com https://esm.sh",
  "connect-src 'self'",
  "upgrade-insecure-requests",
].join("; ");

// Deny every powerful feature we do not use; fullscreen stays available to our
// own origin. Mirrors the specification.website lock-down baseline.
const PERMISSIONS_POLICY = [
  "accelerometer=()",
  "ambient-light-sensor=()",
  "autoplay=()",
  "battery=()",
  "camera=()",
  "display-capture=()",
  "document-domain=()",
  "encrypted-media=()",
  "execution-while-not-rendered=()",
  "execution-while-out-of-viewport=()",
  "fullscreen=(self)",
  "geolocation=()",
  "gyroscope=()",
  "keyboard-map=()",
  "magnetometer=()",
  "microphone=()",
  "midi=()",
  "navigation-override=()",
  "payment=()",
  "picture-in-picture=()",
  "publickey-credentials-get=()",
  "screen-wake-lock=()",
  "sync-xhr=()",
  "usb=()",
  "web-share=()",
  "xr-spatial-tracking=()",
].join(", ");

// Discovery Link header — advertises the site's machine-readable resources on
// every response so agents and crawlers that never parse our HTML can still
// find them (see spec: agent-readiness/link-headers). Relative refs resolve
// against the request URL, keeping this host-agnostic. All rel values are
// IANA-registered: `describedby`, `sitemap`, and `security` (RFC 9116).
export const DISCOVERY_LINK_HEADER = [
  '</llms.txt>; rel="describedby"; type="text/markdown"',
  '</sitemap.xml>; rel="sitemap"; type="application/xml"',
  '</.well-known/security.txt>; rel="security"; type="text/plain"',
].join(", ");

export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": PERMISSIONS_POLICY,
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  // HSTS only in production: sending it over plain HTTP in local dev would pin
  // the browser to HTTPS for localhost. `preload` is safe here because
  // includeSubDomains + a two-year max-age meet the preload-list requirements.
  ...(isProduction
    ? {
        "Strict-Transport-Security":
          "max-age=63072000; includeSubDomains; preload",
      }
    : {}),
};

// Merge the security headers onto an existing response without clobbering
// headers a route already set (Content-Type, Cache-Control, Location, or an
// intentional per-route override such as a relaxed CSP).
export const withSecurityHeaders = (res: Response): Response => {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!res.headers.has(name)) {
      res.headers.set(name, value);
    }
  }
  // Advertise discovery resources unless a route set its own Link header.
  if (!res.headers.has("Link")) {
    res.headers.set("Link", DISCOVERY_LINK_HEADER);
  }
  return res;
};

// The pipeline every response passes through on its way out — the single place
// that owns the order of response transforms. Each step takes the request and
// the response-so-far and returns the next response. Compress first (it rewrites
// the body), then stamp the security headers on the result. New transforms
// (ETag, Server-Timing, …) are added here, in order, rather than nested at the
// call sites.
export const finalizeResponse = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  const compressed = await withCompression(req, res);
  return withSecurityHeaders(compressed);
};

type RouteHandler = (req: BunRequest) => Response | Promise<Response>;

// Wrap a Bun `routes` map so every handler's response runs through
// `finalizeResponse` before it leaves the server.
export const secureRoutes = <T extends Record<string, RouteHandler>>(
  routes: T,
): T => {
  const wrapped: Record<string, RouteHandler> = {};
  for (const [path, handler] of Object.entries(routes)) {
    wrapped[path] = async (req) => finalizeResponse(req, await handler(req));
  }
  return wrapped as T;
};
