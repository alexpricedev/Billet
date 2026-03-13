import type { JSX } from "react";
import { renderToString } from "react-dom/server";

const securityHeaders: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

export const redirect = (url: string, status = 303) =>
  new Response("", { status, headers: { Location: url } });

export const render = (element: JSX.Element): Response =>
  new Response(`<!DOCTYPE html>${renderToString(element)}`, {
    headers: { "Content-Type": "text/html", ...securityHeaders },
  });
