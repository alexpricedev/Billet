import { expect } from "bun:test";

export const createMockRequest = (
  url: string,
  method = "GET",
  body?: unknown,
): Request => {
  const init: RequestInit = { method };

  if (body) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }

  const request = new Request(url, init);
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
