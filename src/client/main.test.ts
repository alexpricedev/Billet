import { afterEach, describe, expect, mock, test } from "bun:test";

describe("main page router", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    delete document.body.dataset.page;
  });

  test("calls home init when data-page is home", async () => {
    const mockInit = mock(() => {});
    mock.module("@client/pages/home", () => ({ init: mockInit }));

    document.body.dataset.page = "home";
    await import("./main");

    expect(mockInit).toHaveBeenCalled();
  });
});
