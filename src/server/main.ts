import { runMigrations } from "./database/migrate";
import { seedIfEmpty } from "./database/seed";
import { adminRoutes } from "./routes/admin";
import { apiRoutes } from "./routes/api";
import { appRoutes } from "./routes/app";
import { initAssets, warnOnMissingDevBundles } from "./services/assets";
import { log } from "./services/logger";
import { validateEnv } from "./utils/env";
import { render500 } from "./utils/errors";
import { handleFallback } from "./utils/fallback";
import {
  handleGuarded,
  secureRoutes,
  withSecurityHeaders,
} from "./utils/security-headers";

validateEnv();
await runMigrations();
await seedIfEmpty();
await initAssets();
await warnOnMissingDevBundles();

const server = Bun.serve({
  port: Number(process.env.PORT),
  idleTimeout: 30,
  routes: secureRoutes({
    ...appRoutes,
    ...adminRoutes,
    ...apiRoutes,
  }),
  async fetch(req) {
    return handleGuarded(req, handleFallback);
  },
  // Last-resort backstop for anything the guarded pipeline doesn't catch (e.g.
  // an error thrown in routing itself). Overriding Bun's default also stops its
  // dev error page — which can leak a stack trace — from ever being served. No
  // request is available here, so headers are stamped without compression.
  error() {
    try {
      return withSecurityHeaders(render500());
    } catch {
      return new Response("Internal Server Error", { status: 500 });
    }
  },
});

log.info("server", `Listening on port ${server.port}`);
