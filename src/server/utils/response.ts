import type { JSX } from "react";
import { renderToString } from "react-dom/server";

export const redirect = (url: string, status = 303) =>
  new Response("", { status, headers: { Location: url } });

export const render = (element: JSX.Element): Response =>
  new Response(renderToString(element), {
    headers: { "Content-Type": "text/html" },
  });
