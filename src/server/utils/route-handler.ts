import type { BunRequest } from "bun";

export function createRouteHandler(handlers: {
  GET?: (req: BunRequest) => Response | Promise<Response>;
  POST?: (req: BunRequest) => Response | Promise<Response>;
  PUT?: (req: BunRequest) => Response | Promise<Response>;
  DELETE?: (req: BunRequest) => Response | Promise<Response>;
}) {
  return async (req: BunRequest) => {
    const handler = handlers[req.method as keyof typeof handlers];

    if (!handler) {
      return new Response("Method not allowed", { status: 405 });
    }

    return handler(req);
  };
}
