import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { init } from "./contact";

describe("contact page init", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <form>
        <input name="name" required minlength="2" />
        <button type="submit">Send</button>
      </form>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("sets initial custom validation message", () => {
    init();

    const input = document.querySelector(
      "input[name='name']",
    ) as HTMLInputElement;
    expect(input.validationMessage).toBe("Oi, enter your name.");
  });

  test("shows tooShort message for short input", () => {
    init();

    const input = document.querySelector(
      "input[name='name']",
    ) as HTMLInputElement;

    // Programmatic .value doesn't set validity.tooShort in happy-dom,
    // so stub the validity object to simulate the browser behaviour
    input.value = "A";
    Object.defineProperty(input, "validity", {
      value: { valueMissing: false, tooShort: true },
      configurable: true,
    });
    input.dispatchEvent(new Event("input"));

    expect(input.validationMessage).toBe("Give me something more");
  });

  test("clears validation when input is valid", () => {
    init();

    const input = document.querySelector(
      "input[name='name']",
    ) as HTMLInputElement;

    input.value = "Alex";
    input.dispatchEvent(new Event("input"));

    expect(input.validationMessage).toBe("");
  });

  test("prevents default form submission", () => {
    init();

    const form = document.querySelector("form");
    if (!form) throw new Error("Form not found");
    let defaultPrevented = false;

    form.addEventListener("submit", (e) => {
      defaultPrevented = e.defaultPrevented;
    });

    form.dispatchEvent(new Event("submit", { cancelable: true }));

    expect(defaultPrevented).toBe(true);
  });

  test("does nothing when form is missing", () => {
    document.body.innerHTML = "";
    init();
  });
});
