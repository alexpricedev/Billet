import { runMigrations } from "./database/migrate";
import { seedIfEmpty } from "./database/seed";
import { adminRoutes } from "./routes/admin";
import { apiRoutes } from "./routes/api";
import { appRoutes } from "./routes/app";
import { initAssets } from "./services/assets";
import { log } from "./services/logger";
import { validateEnv } from "./utils/env";
import { handleFallback } from "./utils/fallback";
import { finalizeResponse, secureRoutes } from "./utils/security-headers";

validateEnv();
await runMigrations();
await seedIfEmpty();
await initAssets();

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
