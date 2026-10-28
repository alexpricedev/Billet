import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { renderToString } from "preact-render-to-string";
import { Flash } from "../../server/components/flash";
import { init } from "./flash-dismiss";

// The server component is the fixture, so a renamed attribute breaks this file
// rather than the page.
const markup = (): string =>
  renderToString(
    <>
      <Flash tone="success" title="Saved." />
      <Flash tone="error" title="Nope." />
    </>,
  );

const buttons = () =>
  document.querySelectorAll<HTMLButtonElement>("[data-flash-dismiss]");
const banners = () => document.querySelectorAll(".flash");

beforeEach(() => {
  document.body.innerHTML = markup();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("flash dismiss", () => {
  test("the × ships hidden so a page with no bundle shows no dead control", () => {
    for (const button of buttons()) expect(button.hidden).toBe(true);
  });

  test("reveals every banner's dismiss button", () => {
    init();

    expect(buttons()).toHaveLength(2);
    for (const button of buttons()) expect(button.hidden).toBe(false);
  });

  test("closes only the banner whose button was clicked", () => {
    init();
    expect(banners()).toHaveLength(2);

    buttons()[0]?.click();

    expect(banners()).toHaveLength(1);
    expect(document.querySelector(".flash")?.getAttribute("data-tone")).toBe(
      "error",
    );
  });

  // Closing is presentation, not a decision to remember: no storage, no
  // request, so a reload puts the banner back.
  test("writes nothing down", () => {
    init();
    buttons()[0]?.click();

    expect(window.localStorage.length).toBe(0);
  });
});
