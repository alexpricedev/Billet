import {
  assetsDir,
  handleAssetRequest,
  isBundleFilename,
} from "../services/assets";
import { render404 } from "./errors";
import { serveDevBundle, serveFile } from "./static-files";

// Catch-all handler for requests not matched by a declared route: trailing-slash
// canonicalisation, the platform health check, and static file serving (hashed
// bundles, the un-hashed dev bundle, and public/ assets). Returns a bare
// Response; callers run it through `finalizeResponse` (compression + security
// headers) before it leaves the server.
export const handleFallback = async (req: Request): Promise<Response> => {
  const url = new URL(req.url);

  // Canonicalise trailing slashes: every path has exactly one URL. Requests
  // for "/stack/" 308-redirect to "/stack" (preserving the query string) so
  // crawlers never index duplicate slashed/unslashed variants.
  if (url.pathname !== "/" && url.pathname.endsWith("/")) {
    const canonical = url.pathname.replace(/\/+$/, "");
    return new Response(null, {
      status: 308,
      headers: { Location: canonical + url.search },
    });
  }

  // Lightweight liveness check for the platform healthcheck. Intentionally
  // does not touch the DB — a transient DB blip should not cause the host to
  // cycle the instance.
  if (url.pathname === "/health") {
    return new Response("ok", { status: 200 });
  }

  if (url.pathname.startsWith("/assets/")) {
    const cached = handleAssetRequest(url);
    if (cached) return cached;

    const filename = url.pathname.slice("/assets/".length);
    const file = Bun.file(`${assetsDir()}/${filename}`);
    if (await file.exists()) return serveDevBundle(file);

    // A build artefact that is absent is not the same as a URL that was never
    // an asset. dist/ is gitignored and rewritten by the watchers, so one of our
    // own bundles going missing is a build-state problem the next `bun run
    // build` fixes — same class as the mid-rebuild empty read, so same answer:
    // 503 + Retry-After, uncached, never a 404 the browser treats as settled.
    // Anything else under /assets/ really is not there: 404.
    if (isBundleFilename(filename)) {
      return new Response(
        `Bundle ${filename} is not built — run \`bun run build\``,
        {
          status: 503,
          headers: { "Retry-After": "1", "Cache-Control": "no-store" },
        },
      );
    }

    return new Response("Asset not found", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }

  if (url.pathname.startsWith("/")) {
    const file = Bun.file(`public${url.pathname}`);
    if (await file.exists()) return serveFile(req, file);
  }

  // No route, no static file: a real 404 with the styled, navigable error page.
  return render404();
};
