import { afterEach, describe, expect, test } from "bun:test";
import { MOUNTED_ATTR } from "./attributes";
import { defineComponent, mount, registerComponent } from "./component";
import { computed, signal } from "./signal";

// A component exercising every binding. Registered once; the registry is
// module state, so each test uses this name or a unique one of its own.
const counter = defineComponent("counter", () => {
  const count = signal(0);
  const label = signal("Count");
  return {
    count,
    label,
    isPositive: computed(() => count.value > 0),
    isZero: computed(() => count.value === 0),
    increment: () => count.set(count.value + 1),
    reset: () => count.set(0),
  };
});
registerComponent(counter);

const byId = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not in fixture`);
  return el as T;
};

const input = (el: HTMLInputElement, value: string) => {
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("mount", () => {
  test("binds text, show, class, attr, prop and on under the root", () => {
    document.body.innerHTML = `
      <div id="root" data-component="counter">
        <span id="count" data-text="count"></span>
        <p id="hint" data-show="isZero">Nothing yet</p>
        <div id="badge" data-class="positive:isPositive zero:isZero"></div>
        <button id="up" data-on="click:increment" data-attr="aria-pressed:isPositive">+</button>
        <button id="reset" data-on="click:reset" data-prop="disabled:isZero">Reset</button>
      </div>
    `;
    mount();

    const root = byId("root");
    const count = byId("count");
    const hint = byId("hint");
    const badge = byId("badge");
    const up = byId<HTMLButtonElement>("up");
    const reset = byId<HTMLButtonElement>("reset");

    expect(root.hasAttribute(MOUNTED_ATTR)).toBe(true);
    expect(count.textContent).toBe("0");
    expect(hint.hidden).toBe(false);
    expect(badge.classList.contains("zero")).toBe(true);
    expect(badge.classList.contains("positive")).toBe(false);
    expect(up.getAttribute("aria-pressed")).toBe("false");
    expect(reset.disabled).toBe(true);

    up.click();
    up.click();

    expect(count.textContent).toBe("2");
    expect(hint.hidden).toBe(true);
    expect(badge.classList.contains("positive")).toBe(true);
    expect(badge.classList.contains("zero")).toBe(false);
    expect(up.getAttribute("aria-pressed")).toBe("true");
    expect(reset.disabled).toBe(false);

    reset.click();
    expect(count.textContent).toBe("0");
  });

  test("value binds a control both ways", () => {
    document.body.innerHTML = `
      <div data-component="counter">
        <input id="label" data-value="label" />
        <output id="echo" data-text="label"></output>
      </div>
    `;
    mount();

    const field = byId<HTMLInputElement>("label");
    const echo = byId("echo");
    expect(field.value).toBe("Count");

    input(field, "Total");
    expect(echo.textContent).toBe("Total");
  });

  test("attr removes the attribute for null and undefined", () => {
    const nullable = defineComponent("nullable", () => {
      const title = signal<string | null>("Hello");
      return { title, clear: () => title.set(null) };
    });
    registerComponent(nullable);
    document.body.innerHTML = `
      <div data-component="nullable">
        <span id="target" data-attr="title:title"></span>
        <button id="clear" data-on="click:clear"></button>
      </div>
    `;
    mount();

    const target = byId("target");
    expect(target.getAttribute("title")).toBe("Hello");
    byId("clear").click();
    expect(target.hasAttribute("title")).toBe(false);
  });

  test("binds attributes on the root element itself", () => {
    document.body.innerHTML = `
      <button id="root" data-component="counter" data-on="click:increment" data-text="count"></button>
    `;
    mount();

    const root = byId("root");
    root.click();
    expect(root.textContent).toBe("1");
  });

  test("leaves elements inside a nested component to that component", () => {
    document.body.innerHTML = `
      <div id="outer" data-component="counter">
        <span id="outer-count" data-text="count"></span>
        <div id="inner" data-component="counter">
          <span id="inner-count" data-text="count"></span>
          <button id="inner-up" data-on="click:increment"></button>
        </div>
      </div>
    `;
    mount();

    byId("inner-up").click();
    expect(byId("inner-count").textContent).toBe("1");
    expect(byId("outer-count").textContent).toBe("0");
  });

  test("skips roots with no registered component", () => {
    document.body.innerHTML = `
      <nav data-component="nav"><span data-text="count">untouched</span></nav>
    `;
    expect(() => mount()).not.toThrow();
    expect(document.querySelector("span")?.textContent).toBe("untouched");
    expect(document.querySelector("nav")?.hasAttribute(MOUNTED_ATTR)).toBe(
      false,
    );
  });

  test("does not bind the same root twice", () => {
    document.body.innerHTML = `
      <div data-component="counter">
        <span id="count" data-text="count"></span>
        <button id="up" data-on="click:increment"></button>
      </div>
    `;
    mount();
    mount();

    byId("up").click();
    expect(byId("count").textContent).toBe("1");
  });

  test("mounting a scope includes the scope element when it is a root", () => {
    document.body.innerHTML = `
      <div id="scope" data-component="counter">
        <span id="count" data-text="count"></span>
      </div>
    `;
    mount(byId("scope"));
    expect(byId("count").textContent).toBe("0");
  });

  test("the disposer removes effects, listeners and the mounted marker", () => {
    document.body.innerHTML = `
      <div id="root" data-component="counter">
        <span id="count" data-text="count"></span>
        <button id="up" data-on="click:increment"></button>
      </div>
    `;
    const unmount = mount();
    const root = byId("root");
    const up = byId("up");

    up.click();
    expect(byId("count").textContent).toBe("1");

    unmount();
    up.click();
    expect(byId("count").textContent).toBe("1");
    expect(root.hasAttribute(MOUNTED_ATTR)).toBe(false);

    // Disposed roots can be mounted again — a fresh factory, fresh state.
    mount();
    expect(byId("count").textContent).toBe("0");
  });
});

describe("mount errors", () => {
  test("names the component and attribute for an unknown binding", () => {
    document.body.innerHTML = `
      <div data-component="counter"><span data-text="missing"></span></div>
    `;
    expect(() => mount()).toThrow(
      '[counter] data-text="missing" must name a signal or computed',
    );
  });

  test("rejects an action where a readable is needed, and vice versa", () => {
    document.body.innerHTML = `
      <div data-component="counter"><span data-text="increment"></span></div>
    `;
    expect(() => mount()).toThrow(/data-text="increment"/);

    document.body.innerHTML = `
      <div data-component="counter"><button data-on="click:count"></button></div>
    `;
    expect(() => mount()).toThrow(/must name an action/);
  });

  test("rejects value on a computed or a non-control", () => {
    document.body.innerHTML = `
      <div data-component="counter"><input data-value="isZero" /></div>
    `;
    expect(() => mount()).toThrow(/data-value="isZero"/);

    document.body.innerHTML = `
      <div data-component="counter"><span data-value="label"></span></div>
    `;
    expect(() => mount()).toThrow(/data-value="label"/);
  });
});
