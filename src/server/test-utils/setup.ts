import { expect } from "bun:test";
import type { BunRequest } from "bun";
import type { JsonErrorBody } from "../utils/response";
import { createBunRequest } from "./bun-request";

export const createMockRequest = (
  url: string,
  method = "GET",
  // A string is sent verbatim so a test can post a malformed body; anything
  // else is serialised.
  body?: unknown,
  // Overrides the JSON default. The API's Content-Type guard is only testable
  // if a caller can send the wrong media type, or none at all.
  headers?: Record<string, string>,
): BunRequest => {
  const init: RequestInit = { method };

  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
    init.headers = { "Content-Type": "application/json", ...headers };
  } else if (headers) {
    init.headers = headers;
  }

  const request = createBunRequest(url, init);
  Object.defineProperty(request, "method", {
    value: method,
    writable: false,
  });

  return request;
};

export const expectJsonResponse = async (
  response: Response,
  expectedData: unknown,
) => {
  expect(response.headers.get("content-type")).toContain("application/json");
  const data = await response.json();
  expect(data).toEqual(expectedData);
};

/**
 * Assert the shared `{ error: { code, message } }` envelope from
 * `utils/response.ts`. Checking the code rather than the prose keeps a test
 * from breaking when a message is reworded.
 */
export const expectJsonError = async (
  response: Response,
  status: number,
  code: string,
): Promise<JsonErrorBody> => {
  expect(response.status).toBe(status);
  expect(response.headers.get("content-type")).toContain("application/json");
  const body = (await response.json()) as JsonErrorBody;
  expect(body.error?.code).toBe(code);
  expect(typeof body.error?.message).toBe("string");
  // Returned because a Response body can only be read once — a caller that
  // wants to assert on `fields` has no way to re-read it.
  return body;
};
