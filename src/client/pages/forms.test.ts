import { afterEach, beforeEach, describe, expect, test } from "bun:test";

describe("forms page init", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <nav>
        <form method="post" action="/auth/logout">
          <input type="hidden" name="_csrf" value="token" />
          <button type="submit">Logout</button>
        </form>
      </nav>
      <section class="card form-card">
        <form method="POST" action="/forms">
          <input type="hidden" name="_csrf" value="csrf-token" />
          <div class="form-field">
            <label for="name-input">Name</label>
            <input id="name-input" name="name" type="text" required minlength="3" />
          </div>
          <div class="form-field">
            <label for="email-input">Email</label>
            <input id="email-input" name="email" type="email" />
          </div>
          <div class="form-field">
            <label for="message-input">Message</label>
            <textarea id="message-input" name="message"></textarea>
          </div>
          <button type="submit">Submit</button>
        </form>
      </section>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("sets initial custom validation message", async () => {
    const { init } = await import("./forms");
    init();

    const input = document.querySelector(
      ".form-card input[name='name']",
    ) as HTMLInputElement;
    expect(input.validationMessage).toBe("Oi, enter your name.");
  });

  test("shows tooShort message for short input", async () => {
    const { init } = await import("./forms");
    init();

    const input = document.querySelector(
      ".form-card input[name='name']",
    ) as HTMLInputElement;

    input.value = "A";
    Object.defineProperty(input, "validity", {
      value: { valueMissing: false, tooShort: true },
      configurable: true,
    });
    input.dispatchEvent(new Event("input"));

    expect(input.validationMessage).toBe("Give me something more");
  });

  test("clears validation when input is valid", async () => {
    const { init } = await import("./forms");
    init();

    const input = document.querySelector(
      ".form-card input[name='name']",
    ) as HTMLInputElement;

    input.value = "Alex";
    input.dispatchEvent(new Event("input"));

    expect(input.validationMessage).toBe("");
  });

  test("does nothing when form-card is missing", async () => {
    document.body.innerHTML = "";
    const { init } = await import("./forms");
    init();
  });
});
