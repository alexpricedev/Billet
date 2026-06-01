import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  cleanupCurrentPage,
  initializePage,
  registerPage,
} from "./page-lifecycle";

afterEach(() => {
  // Reset the active-page state between tests. The module keeps its registry
  // and current-page pointer at module scope, so clear the pointer here rather
  // than re-importing the module (a self-referential mock.module factory busy-
  // loops the resolver on some bun versions).
  cleanupCurrentPage();
});

describe("registerPage + initializePage", () => {
  test("calls init on a registered page", () => {
    const init = mock(() => {});
    registerPage("dashboard", { init });

    initializePage("dashboard");

    expect(init).toHaveBeenCalledTimes(1);
  });

  test("does nothing for undefined page name", () => {
    expect(() => initializePage(undefined)).not.toThrow();
  });

  test("does nothing for unregistered page name", () => {
    expect(() => initializePage("nonexistent")).not.toThrow();
  });
});

describe("cleanupCurrentPage", () => {
  test("calls cleanup on the current page", () => {
    const cleanup = mock(() => {});
    registerPage("dashboard", { init: () => {}, cleanup });

    initializePage("dashboard");
    cleanupCurrentPage();

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  test("does nothing when no page is active", () => {
    expect(() => cleanupCurrentPage()).not.toThrow();
  });

  test("does nothing when page has no cleanup", () => {
    registerPage("simple", { init: () => {} });

    initializePage("simple");
    expect(() => cleanupCurrentPage()).not.toThrow();
  });

  test("clears current page after cleanup", () => {
    const cleanup = mock(() => {});
    registerPage("dashboard", { init: () => {}, cleanup });

    initializePage("dashboard");
    cleanupCurrentPage();
    cleanupCurrentPage();

    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
