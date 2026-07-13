import { describe, expect, test } from "bun:test";
import { createBunRequest } from "../test-utils/bun-request";
import {
  SECURITY_HEADERS,
  secureRoutes,
  withSecurityHeaders,
} from "./security-headers";

describe("withSecurityHeaders", () => {
  test("adds the core security headers to a bare response", () => {
    const res = withSecurityHeaders(new Response("ok"));

    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(res.headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(res.headers.get("Permissions-Policy")).toContain("camera=()");
  });

  test("sets a Content-Security-Policy with clickjacking and upgrade directives", () => {
    const res = withSecurityHeaders(new Response("ok"));
    const csp = res.headers.get("Content-Security-Policy") ?? "";

    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("upgrade-insecure-requests");
  });

  test("does not clobber headers a response already set", () => {
    const res = withSecurityHeaders(
      new Response("ok", {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=60",
        },
      }),
    );

    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  test("omits HSTS outside production", () => {
    // Tests run with NODE_ENV=test, so the strict-transport header is withheld
    // to avoid pinning localhost to HTTPS.
    expect(SECURITY_HEADERS["Strict-Transport-Security"]).toBeUndefined();
  });
});

describe("secureRoutes", () => {
  test("decorates every handler's response with security headers", async () => {
    const routes = secureRoutes({
      "/thing": (_req) => new Response("thing"),
    });

    const req = createBunRequest("http://localhost:3000/thing");
    const res = await routes["/thing"](req);

    expect(await res.text()).toBe("thing");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Security-Policy")).toContain(
      "frame-ancestors 'none'",
    );
  });

  test("awaits async handlers before decorating", async () => {
    const routes = secureRoutes({
      "/async": async (_req) => new Response("async"),
    });

    const req = createBunRequest("http://localhost:3000/async");
    const res = await routes["/async"](req);

    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });
});
