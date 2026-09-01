import type { JSX } from "preact";
import { renderToString } from "preact-render-to-string";

// Security headers are applied centrally to every response — see
// `secureRoutes` and the `fetch` fallback in main.ts — so producers here only
// set content-specific headers.

export const redirect = (url: string, status = 303) =>
  new Response("", { status, headers: { Location: url } });

export const render = (
  element: JSX.Element,
  // Content-specific extras only, e.g. the `no-store` a page holding a live
  // single-use token needs. Content-Type is set here and can't be overridden.
  headers: Record<string, string> = {},
): Response =>
  new Response(`<!DOCTYPE html>${renderToString(element)}`, {
    headers: { ...headers, "Content-Type": "text/html" },
  });

// The error envelope every JSON producer uses — the `/api` controllers and the
// rate limiter alike. One shape across the surface means a client can find out
// *why* a request failed without special-casing per endpoint, or parsing prose
// out of a text/plain body it never asked for. `code` is the stable identifier
// to branch on and never changes wording; `message` is for whoever is reading
// the response; `fields` carries per-field detail when a body failed validation.
export type JsonErrorBody = {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
};

export const jsonError = (
  status: number,
  code: string,
  message: string,
  // Content-specific extras only, matching `render` above: `Allow` on a 405,
  // `Retry-After` on a 429. Security headers are still applied centrally.
  options: {
    fields?: Record<string, string>;
    headers?: Record<string, string>;
  } = {},
): Response => {
  const body: JsonErrorBody = { error: { code, message } };
  if (options.fields) {
    body.error.fields = options.fields;
  }
  return Response.json(body, { status, headers: options.headers });
};
