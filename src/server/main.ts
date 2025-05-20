import { renderToReadableStream } from "react-dom/server";

import { routes } from "./routes";

const server = Bun.serve({
  port: process.env.PORT || 3000,
  async fetch(req) {
    const url = new URL(req.url);

    // Serve compiled JS/CSS from the dist directory
    if (url.pathname.startsWith("/assets/")) {
      const file = Bun.file(`dist${url.pathname}`);
      if (await file.exists()) return new Response(file);
      return new Response("Not found", { status: 404 });
    }

    // Handle page routes
    const elementFactory = routes[url.pathname];
    if (elementFactory) {
      const element = elementFactory(req);
      const stream = await renderToReadableStream(element);
      return new Response(stream, {
        headers: { "Content-Type": "text/html" },
      });
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
