import { describe, expect, test } from "bun:test";
import { SITE_NAME } from "../services/seo";
import { createBunRequest } from "../test-utils/bun-request";
import {
  handleGuarded,
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

  test("sets a Content-Security-Policy with clickjacking directives", () => {
    const res = withSecurityHeaders(new Response("ok"));
    const csp = res.headers.get("Content-Security-Policy") ?? "";

    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
  });

  test("omits upgrade-insecure-requests outside production", () => {
    // Production-only for the same reason as HSTS below — and unlike Chrome,
    // WebKit upgrades http://localhost subresources too, so shipping it in dev
    // strips every asset off the page under the browser smoke tests.
    const res = withSecurityHeaders(new Response("ok"));
    const csp = res.headers.get("Content-Security-Policy") ?? "";

    expect(csp).not.toContain("upgrade-insecure-requests");
  });

  test("advertises discovery resources via a Link header", () => {
    const res = withSecurityHeaders(new Response("ok"));
    const link = res.headers.get("Link") ?? "";

    expect(link).toContain('</llms.txt>; rel="describedby"');
    expect(link).toContain('</sitemap.xml>; rel="sitemap"');
    expect(link).toContain('</.well-known/security.txt>; rel="security"');
  });

  test("does not clobber a Link header a response already set", () => {
    const res = withSecurityHeaders(
      new Response("ok", { headers: { Link: "<https://x.test>; rel=next" } }),
    );

    expect(res.headers.get("Link")).toBe("<https://x.test>; rel=next");
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

  test("signs a redirect with X-Redirect-By", () => {
    const res = withSecurityHeaders(
      new Response(null, { status: 308, headers: { Location: "/canonical" } }),
    );

    expect(res.headers.get("X-Redirect-By")).toBe(SITE_NAME);
  });

  test("does not add X-Redirect-By to a non-redirect response", () => {
    const res = withSecurityHeaders(new Response("ok"));

    expect(res.headers.get("X-Redirect-By")).toBeNull();
  });
});

describe("handleGuarded", () => {
  test("serves a styled 500 without leaking the error when the producer throws", async () => {
    const req = createBunRequest("http://localhost:3000/boom");
    const res = await handleGuarded(req, () => {
      throw new Error("db exploded at /secret/path.ts:42");
    });

    expect(res.status).toBe(500);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("Something went wrong");
    expect(body).not.toContain("db exploded");
    // Still runs through the header pipeline.
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  test("passes a successful response through unchanged", async () => {
    const req = createBunRequest("http://localhost:3000/ok");
    const res = await handleGuarded(req, () => new Response("hi"));

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hi");
  });

  test("serves a 503 with Retry-After when maintenance mode is on", async () => {
    const previous = process.env.MAINTENANCE_MODE;
    process.env.MAINTENANCE_MODE = "true";
    try {
      const req = createBunRequest("http://localhost:3000/anything");
      const res = await handleGuarded(
        req,
        () => new Response("should not run"),
      );

      expect(res.status).toBe(503);
      expect(res.headers.get("Retry-After")).toBe("3600");
      expect(await res.text()).toContain("be right back");
    } finally {
      if (previous === undefined) {
        delete process.env.MAINTENANCE_MODE;
      } else {
        process.env.MAINTENANCE_MODE = previous;
      }
    }
  });

  test("keeps the health check alive during maintenance", async () => {
    const previous = process.env.MAINTENANCE_MODE;
    process.env.MAINTENANCE_MODE = "true";
    try {
      const req = createBunRequest("http://localhost:3000/health");
      const res = await handleGuarded(
        req,
        () => new Response("ok", { status: 200 }),
      );

      expect(res.status).toBe(200);
      expect(await res.text()).toBe("ok");
    } finally {
      if (previous === undefined) {
        delete process.env.MAINTENANCE_MODE;
      } else {
        process.env.MAINTENANCE_MODE = previous;
      }
    }
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
