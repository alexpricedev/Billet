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
