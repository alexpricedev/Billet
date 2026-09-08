import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { CSRF_HEADER, FRAGMENT_HEADER } from "@shared/protocol";
import { RequestError, submitForm } from "./request";

type Call = { url: string; init: RequestInit };

const calls: Call[] = [];
let responses: Response[] = [];
const realFetch = globalThis.fetch;

// happy-dom's fetch enforces the Same-Origin Policy against its fake window
// and would try the network; swap in a recorder for the file.
beforeEach(() => {
  calls.length = 0;
  responses = [];
  globalThis.fetch = mock(
    async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      const next = responses.shift();
      if (!next) throw new Error("No response queued");
      return next;
    },
  ) as unknown as typeof fetch;

  document.body.innerHTML = `
    <form id="add" method="POST" action="/todos">
      <input type="hidden" name="_csrf" value="token-1" />
      <input name="title" value="Buy milk" />
      <input type="checkbox" name="urgent" value="yes" />
      <input type="checkbox" name="done" value="yes" checked />
      <input name="ignored" value="x" disabled />
      <button type="submit" name="submit" value="add">Add</button>
    </form>
  `;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  document.body.innerHTML = "";
});

const form = (): HTMLFormElement => {
  const el = document.getElementById("add");
  if (!(el instanceof HTMLFormElement)) throw new Error("No form");
  return el;
};

const headersOf = (call: Call): Record<string, string> =>
  call.init.headers as Record<string, string>;

describe("submitForm", () => {
  test("posts the form's fields to its action with the fragment and CSRF headers", async () => {
    responses.push(new Response("<tr>row</tr>", { status: 201 }));

    const html = await submitForm(form());

    expect(html).toBe("<tr>row</tr>");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/todos");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.credentials).toBe("same-origin");
    expect(calls[0].init.redirect).toBe("manual");
    expect(headersOf(calls[0])[FRAGMENT_HEADER]).toBe("1");
    expect(headersOf(calls[0])[CSRF_HEADER]).toBe("token-1");
    expect(headersOf(calls[0]).Accept).toBe("text/html");

    // The same fields a plain post would carry: no unchecked box, no
    // disabled control, no button.
    const body = calls[0].init.body as URLSearchParams;
    expect(Array.from(body.entries())).toEqual([
      ["_csrf", "token-1"],
      ["title", "Buy milk"],
      ["done", "yes"],
    ]);
  });

  test("retries once with the fresh token a 403 carries, and keeps it in the form", async () => {
    responses.push(
      new Response("", { status: 403, headers: { [CSRF_HEADER]: "token-2" } }),
      new Response("<tr>row</tr>"),
    );

    const html = await submitForm(form());

    expect(html).toBe("<tr>row</tr>");
    expect(calls).toHaveLength(2);
    expect(headersOf(calls[1])[CSRF_HEADER]).toBe("token-2");
    const input = form().querySelector<HTMLInputElement>('input[name="_csrf"]');
    expect(input?.value).toBe("token-2");
  });

  test("does not retry a 403 without a fresh token", async () => {
    responses.push(new Response("Invalid CSRF token", { status: 403 }));

    await expect(submitForm(form())).rejects.toBeInstanceOf(RequestError);
    expect(calls).toHaveLength(1);
  });

  test("rejects with the status and body of any other failure", async () => {
    responses.push(new Response("nope", { status: 500 }));

    const error = await submitForm(form()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RequestError);
    expect((error as RequestError).status).toBe(500);
    expect((error as RequestError).body).toBe("nope");
  });

  test("resolves empty for a 204", async () => {
    responses.push(new Response(null, { status: 204 }));
    expect(await submitForm(form())).toBe("");
  });

  test("sends no CSRF header when the form has no token field", async () => {
    form().querySelector('input[name="_csrf"]')?.remove();
    responses.push(new Response("ok"));

    await submitForm(form());
    expect(headersOf(calls[0])[CSRF_HEADER]).toBeUndefined();
  });
});
