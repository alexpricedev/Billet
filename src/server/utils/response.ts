import type { JSX } from "react";
import { renderToReadableStream } from "react-dom/server";

export const redirect = (url: string, status = 303) =>
  new Response("", { status, headers: { Location: url } });

export const render = async (element: JSX.Element): Promise<Response> =>
  new Response(await renderToReadableStream(element), {
    headers: { "Content-Type": "text/html" },
  });
