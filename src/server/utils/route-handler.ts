export function createRouteHandler(handlers: {
  GET?: (req: Request) => Response | Promise<Response>;
  POST?: (req: Request) => Response | Promise<Response>;
  PUT?: (req: Request) => Response | Promise<Response>;
  DELETE?: (req: Request) => Response | Promise<Response>;
}) {
  return async (req: Request) => {
    const handler = handlers[req.method as keyof typeof handlers];

    if (!handler) {
      return new Response("Method not allowed", { status: 405 });
    }

    return handler(req);
  };
}
