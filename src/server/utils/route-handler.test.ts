import { describe, expect, test } from "bun:test";
import { createMockRequest } from "../test-utils/setup";
import { createApiRouteHandler, createRouteHandler } from "./route-handler";

const ok = () => new Response("ok");
const url = "http://localhost:3000/anything";

describe("createRouteHandler", () => {
  test("dispatches to the handler for the request method", async () => {
    const handler = createRouteHandler({
      GET: ok,
      POST: () => new Response("created", { status: 201 }),
    });

    expect((await handler(createMockRequest(url))).status).toBe(200);
    expect((await handler(createMockRequest(url, "POST"))).status).toBe(201);
  });

  test("answers an unlisted method with 405 and an Allow header", async () => {
    const handler = createRouteHandler({ GET: ok, POST: ok });
    const response = await handler(createMockRequest(url, "DELETE"));

    expect(response.status).toBe(405);
    // Without this a client that guessed the verb wrong has no way to learn
    // which ones the resource actually answers.
    expect(response.headers.get("Allow")).toBe("GET, POST");
    expect(await response.text()).toBe("Method not allowed");
  });
});

describe("createApiRouteHandler", () => {
  test("answers an unlisted method with the JSON error envelope", async () => {
    const handler = createApiRouteHandler({ GET: ok });
    const response = await handler(createMockRequest(url, "PUT"));

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET");
    expect(response.headers.get("content-type")).toContain("application/json");

    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("method_not_allowed");
  });

  test("still dispatches listed methods", async () => {
    const handler = createApiRouteHandler({ GET: ok });

    expect((await handler(createMockRequest(url))).status).toBe(200);
  });
});
