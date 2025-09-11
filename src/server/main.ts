import { apiRoutes } from "./routes/api";
import { viewRoutes } from "./routes/views";

const server = Bun.serve({
  port: process.env.PORT || 3000,
  idleTimeout: 30, // 30 second timeout
  routes: {
    ...viewRoutes,
    ...apiRoutes,
  },
  async fetch(req) {
    const url = new URL(req.url);

    // Serve compiled JS/CSS from the dist directory
    if (url.pathname.startsWith("/assets/")) {
      const file = Bun.file(`dist${url.pathname}`);
      if (await file.exists()) return new Response(file);
      return new Response("Asset not found", { status: 404 });
    }

    // Serve static files from the public directory
    if (url.pathname.startsWith("/")) {
      const file = Bun.file(`public${url.pathname}`);
      if (await file.exists()) return new Response(file);
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`Server running at http://localhost:${server.port}`);
