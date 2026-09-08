import { describe, expect, test } from "bun:test";
import { FRAGMENT_HEADER } from "@shared/protocol";
import { emptyFragment, isFragmentRequest, renderFragment } from "./fragment";

describe("isFragmentRequest", () => {
  test("is true only for the header the client helper sends", () => {
    expect(
      isFragmentRequest(
        new Request("http://localhost:3000/todos", {
          headers: { [FRAGMENT_HEADER]: "1" },
        }),
      ),
    ).toBe(true);
    expect(isFragmentRequest(new Request("http://localhost:3000/todos"))).toBe(
      false,
    );
    expect(
      isFragmentRequest(
        new Request("http://localhost:3000/todos", {
          headers: { [FRAGMENT_HEADER]: "yes" },
        }),
      ),
    ).toBe(false);
  });
});

describe("renderFragment", () => {
  test("renders the element as HTML with no doctype and no caching", async () => {
    const response = renderFragment(<tr data-id="1">Row</tr>);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/html");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).toBe('<tr data-id="1">Row</tr>');
  });

  test("takes a status and extra headers", () => {
    const response = renderFragment(<tr />, {
      status: 201,
      headers: { Location: "/todos/1" },
    });

    expect(response.status).toBe(201);
    expect(response.headers.get("Location")).toBe("/todos/1");
  });
});

describe("emptyFragment", () => {
  test("is a 204 with no body", async () => {
    const response = emptyFragment();
    expect(response.status).toBe(204);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).toBe("");
  });
});
