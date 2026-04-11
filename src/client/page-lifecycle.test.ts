import { afterEach, describe, expect, mock, test } from "bun:test";

afterEach(() => {
  // Re-import to get fresh module state each test
  mock.module("./page-lifecycle", () => import("./page-lifecycle"));
});

async function freshModule() {
  return await import("./page-lifecycle");
}

describe("registerPage + initializePage", () => {
  test("calls init on a registered page", async () => {
    const { registerPage, initializePage } = await freshModule();
    const init = mock(() => {});
    registerPage("dashboard", { init });

    initializePage("dashboard");

    expect(init).toHaveBeenCalledTimes(1);
  });

  test("does nothing for undefined page name", async () => {
    const { initializePage } = await freshModule();
    expect(() => initializePage(undefined)).not.toThrow();
  });

  test("does nothing for unregistered page name", async () => {
    const { initializePage } = await freshModule();
    expect(() => initializePage("nonexistent")).not.toThrow();
  });
});

describe("cleanupCurrentPage", () => {
  test("calls cleanup on the current page", async () => {
    const { registerPage, initializePage, cleanupCurrentPage } =
      await freshModule();
    const cleanup = mock(() => {});
    registerPage("dashboard", { init: () => {}, cleanup });

    initializePage("dashboard");
    cleanupCurrentPage();

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  test("does nothing when no page is active", async () => {
    const { cleanupCurrentPage } = await freshModule();
    expect(() => cleanupCurrentPage()).not.toThrow();
  });

  test("does nothing when page has no cleanup", async () => {
    const { registerPage, initializePage, cleanupCurrentPage } =
      await freshModule();
    registerPage("simple", { init: () => {} });

    initializePage("simple");
    expect(() => cleanupCurrentPage()).not.toThrow();
  });

  test("clears current page after cleanup", async () => {
    const { registerPage, initializePage, cleanupCurrentPage } =
      await freshModule();
    const cleanup = mock(() => {});
    registerPage("dashboard", { init: () => {}, cleanup });

    initializePage("dashboard");
    cleanupCurrentPage();
    cleanupCurrentPage();

    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
