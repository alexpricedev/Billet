// The client's one conversation with the server, imported as a namespace so
// every call reads `server.submit(form)` and the enhanced forms in a codebase
// are one grep away.
//
// A component intercepts a form's `submit` event and
// sends the same fields to the same action, with two headers on top: the CSRF
// token from the form's hidden field, promoted to the header `checkCsrf` reads
// first, and the fragment header that tells the controller to answer with
// rendered HTML instead of the redirect a plain post gets. The form is still a
// working form — without JavaScript the browser posts it and the redirect flow
// takes over — so the enhancement adds nothing the page couldn't do already.
//
// Tokens are time-bucketed on the server, and a stale one still proves
// possession of the session, so a controller answers it with a 403 carrying a
// fresh token in the same header. `submit` writes that token back into the
// form and retries once. Anything else is thrown as a `RequestError` for the
// caller to decide about — the usual answer is to fall back to `form.submit()`
// and let the server render the flash it would have rendered anyway.

import { CSRF_FIELD, CSRF_HEADER, FRAGMENT_HEADER } from "@shared/protocol";

export class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Request failed with ${status}`);
    this.name = "RequestError";
  }
}

const csrfInput = (form: HTMLFormElement): HTMLInputElement | null =>
  form.querySelector<HTMLInputElement>(`input[name="${CSRF_FIELD}"]`);

// What the browser would put in a urlencoded post of this form: every named,
// enabled control, with unchecked boxes and radios left out. Done by hand
// rather than through `new FormData(form)` so the body is the same shape a
// plain post sends, and so the helper works under happy-dom, whose preload
// restores Bun's FormData, which cannot read a form element.
const fields = (form: HTMLFormElement): URLSearchParams => {
  const body = new URLSearchParams();
  for (const el of Array.from(form.elements)) {
    if (el instanceof HTMLSelectElement) {
      if (!el.name || el.disabled) continue;
      for (const option of Array.from(el.selectedOptions)) {
        body.append(el.name, option.value);
      }
    } else if (
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement
    ) {
      if (!el.name || el.disabled) continue;
      if (el instanceof HTMLInputElement) {
        if (["submit", "button", "reset", "file"].includes(el.type)) continue;
        if ((el.type === "checkbox" || el.type === "radio") && !el.checked) {
          continue;
        }
      }
      body.append(el.name, el.value);
    }
  }
  return body;
};

const send = (form: HTMLFormElement): Promise<Response> => {
  const body = fields(form);

  const headers: Record<string, string> = {
    Accept: "text/html",
    [FRAGMENT_HEADER]: "1",
  };
  const token = csrfInput(form)?.value;
  if (token) headers[CSRF_HEADER] = token;

  return fetch(form.action, {
    method: form.method || "POST",
    body,
    headers,
    credentials: "same-origin",
    // A controller that redirects (requireAuth sending a guest to /login) is
    // answering a plain post, not a fragment request. Following it would hand
    // the caller a whole login page to insert as a row; refusing it makes the
    // response opaque and not ok, so it fails and the form falls back.
    redirect: "manual",
  });
};

/**
 * Parse the HTML a fragment response returned into its element. `parent` is
 * the tag the markup is legal inside: a `<tr>` needs a `tbody`, most things
 * are fine in the default `div`. A table row parsed on its own is silently
 * dropped by the HTML parser, which is the whole reason this takes a parent.
 */
export function parse(html: string, parent = "div"): HTMLElement {
  const holder = document.createElement(parent);
  holder.innerHTML = html;
  const el = holder.firstElementChild;
  if (!(el instanceof HTMLElement)) {
    throw new RequestError(200, "Fragment response contained no element");
  }
  return el;
}

/**
 * Post `form` as a fragment request and resolve with the response body — the
 * HTML the controller rendered, or empty for a 204. Retries once when the
 * server refreshes a stale CSRF token; rejects with `RequestError` otherwise.
 */
export async function submit(form: HTMLFormElement): Promise<string> {
  let response = await send(form);

  const refreshed = response.headers.get(CSRF_HEADER);
  if (response.status === 403 && refreshed) {
    const input = csrfInput(form);
    if (input) input.value = refreshed;
    response = await send(form);
  }

  const text = await response.text();
  if (!response.ok) throw new RequestError(response.status, text);
  return text;
}
