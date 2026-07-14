import { runMigrations } from "./database/migrate";
import { seedIfEmpty } from "./database/seed";
import { adminRoutes } from "./routes/admin";
import { apiRoutes } from "./routes/api";
import { appRoutes } from "./routes/app";
import { handleAssetRequest, initAssets } from "./services/assets";
import { log } from "./services/logger";
import { validateEnv } from "./utils/env";
import { finalizeResponse, secureRoutes } from "./utils/security-headers";
import { serveFile } from "./utils/static-files";

validateEnv();
await runMigrations();
await seedIfEmpty();
await initAssets();

// Fallback handler for everything not matched by a declared route. Returns a
// bare Response; the `fetch` wrapper below runs it through `finalizeResponse`
// (compression + security headers) before it leaves the server.
const handleFallback = async (req: Request): Promise<Response> => {
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

    const file = Bun.file(`dist${url.pathname}`);
    if (await file.exists()) return serveFile(req, file);
    return new Response("Asset not found", { status: 404 });
  }

  if (url.pathname.startsWith("/")) {
    const file = Bun.file(`public${url.pathname}`);
    if (await file.exists()) return serveFile(req, file);
  }

  return new Response("Not found", { status: 404 });
};

const server = Bun.serve({
  port: Number(process.env.PORT),
  idleTimeout: 30,
  routes: secureRoutes({
    ...appRoutes,
    ...adminRoutes,
    ...apiRoutes,
  }),
  async fetch(req) {
    return finalizeResponse(req, await handleFallback(req));
  },
});

log.info("server", `Listening on port ${server.port}`);
