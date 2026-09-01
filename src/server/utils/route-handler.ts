import type { BunRequest } from "bun";
import { jsonError } from "./response";

type MethodHandlers = {
  GET?: (req: BunRequest) => Response | Promise<Response>;
  POST?: (req: BunRequest) => Response | Promise<Response>;
  PUT?: (req: BunRequest) => Response | Promise<Response>;
  DELETE?: (req: BunRequest) => Response | Promise<Response>;
};

// The methods this resource answers, in the order they were declared. RFC 9110
// requires a 405 to name them in `Allow`, and it is the only way a client that
// guessed wrong can find out what to send instead. HEAD rides along with GET —
// dispatch answers it below — so it is advertised too.
const allowHeader = (handlers: MethodHandlers): Record<string, string> => ({
  Allow: Object.keys(handlers)
    .flatMap((method) => (method === "GET" ? ["GET", "HEAD"] : [method]))
    .join(", "),
});

const dispatch =
  (
    handlers: MethodHandlers,
    notAllowed: (req: BunRequest) => Response,
  ): ((req: BunRequest) => Response | Promise<Response>) =>
  async (req) => {
    const handler = handlers[req.method as keyof MethodHandlers];
    if (handler) return handler(req);

    // HEAD is GET without the body: run the GET handler for its status and
    // headers, then drop the body here rather than trusting the runtime to.
    // Crawlers and uptime monitors probe with HEAD, and a 405 reads as "down".
    if (req.method === "HEAD" && handlers.GET) {
      const res = await handlers.GET(req);
      return new Response(null, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      });
    }

    return notAllowed(req);
  };

// HTML routes. The 405 body stays plain text — it is read by a person poking at
// a URL, not by a program.
export function createRouteHandler(handlers: MethodHandlers) {
  return dispatch(
    handlers,
    () =>
      new Response("Method not allowed", {
        status: 405,
        headers: allowHeader(handlers),
      }),
  );
}

// JSON routes. Same dispatch, and the same `Allow` header — only the body
// differs, so a caller that reaches `/api/*` with the wrong verb gets the error
// envelope every other API failure uses rather than prose it can't parse.
export function createApiRouteHandler(handlers: MethodHandlers) {
  return dispatch(handlers, (req) =>
    jsonError(
      405,
      "method_not_allowed",
      `${req.method} is not supported on this resource.`,
      { headers: allowHeader(handlers) },
    ),
  );
}
