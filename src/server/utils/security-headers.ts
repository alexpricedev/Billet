import type { BunRequest } from "bun";

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
  return res;
};

type RouteHandler = (req: BunRequest) => Response | Promise<Response>;

// Wrap a Bun `routes` map so every handler's response is decorated with the
// security headers before it leaves the server.
export const secureRoutes = <T extends Record<string, RouteHandler>>(
  routes: T,
): T => {
  const wrapped: Record<string, RouteHandler> = {};
  for (const [path, handler] of Object.entries(routes)) {
    wrapped[path] = async (req) => withSecurityHeaders(await handler(req));
  }
  return wrapped as T;
};
