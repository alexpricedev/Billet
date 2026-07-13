import type { JSX } from "react";
import { renderToString } from "react-dom/server";

// Security headers are applied centrally to every response — see
// `secureRoutes` and the `fetch` fallback in main.ts — so producers here only
// set content-specific headers.

export const redirect = (url: string, status = 303) =>
  new Response("", { status, headers: { Location: url } });

export const render = (element: JSX.Element): Response =>
  new Response(`<!DOCTYPE html>${renderToString(element)}`, {
    headers: { "Content-Type": "text/html" },
  });
