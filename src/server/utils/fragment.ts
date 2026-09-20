import { CSRF_HEADER, FRAGMENT_HEADER } from "@shared/protocol";
import type { JSX } from "preact";
import { renderToString } from "preact-render-to-string";
import { createCsrfToken } from "../services/csrf";

// The server half of the fragment protocol in `src/shared/protocol.ts`. A
// plain form post gets the redirect-and-flash flow; the same post sent by the
// client's `server.submit` carries the fragment header, and the controller answers
// with the one piece of rendered HTML the page needs to update itself — a row,
// a card — through the same server component the full page renders with, so
// the two can't drift. Security headers are still applied centrally.

export const isFragmentRequest = (req: Request): boolean =>
  req.headers.get(FRAGMENT_HEADER) === "1";

export const renderFragment = (
  element: JSX.Element,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response =>
  new Response(renderToString(element), {
    status: init.status ?? 200,
    headers: {
      ...init.headers,
      "Content-Type": "text/html",
      // A fragment is a reply to one action, never a page to keep.
      "Cache-Control": "no-store",
    },
  });

// For an action whose result is "gone": the client removes what it had.
export const emptyFragment = (): Response =>
  new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });

// The fragment counterpart of the flash-and-redirect a stale token gets on a
// plain post. The token was authentic, just old, so hand back a fresh one in
// the header `server.submit` retries with. Never called for any other CSRF
// failure — see `isRecoverableCsrfFailure`.
export const refreshCsrfToken = async (
  sessionId: string,
  method: string,
  path: string,
): Promise<Response> =>
  new Response(null, {
    status: 403,
    headers: {
      [CSRF_HEADER]: await createCsrfToken(sessionId, method, path),
      "Cache-Control": "no-store",
    },
  });
