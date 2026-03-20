import { runMigrations } from "./database/migrate";
import { seedIfEmpty } from "./database/seed";
import { adminRoutes } from "./routes/admin";
import { apiRoutes } from "./routes/api";
import { appRoutes } from "./routes/app";
import { handleAssetRequest, initAssets } from "./services/assets";
import { log } from "./services/logger";
import { validateEnv } from "./utils/env";

validateEnv();
await runMigrations();
await seedIfEmpty();
await initAssets();

const server = Bun.serve({
  port: Number(process.env.PORT),
  idleTimeout: 30,
  routes: {
    ...appRoutes,
    ...adminRoutes,
    ...apiRoutes,
  },
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname.startsWith("/assets/")) {
      const cached = handleAssetRequest(url);
      if (cached) return cached;

      const file = Bun.file(`dist${url.pathname}`);
      if (await file.exists()) return new Response(file);
      return new Response("Asset not found", { status: 404 });
    }

    if (url.pathname.startsWith("/")) {
      const file = Bun.file(`public${url.pathname}`);
      if (await file.exists()) return new Response(file);
    }

    return new Response("Not found", { status: 404 });
  },
});

log.info("server", `Listening on port ${server.port}`);
