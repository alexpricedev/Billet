import { afterEach, describe, expect, test } from "bun:test";
import { MOUNTED_ATTR } from "@shared/attributes";
import {
  bind,
  defineComponent,
  mount,
  perElement,
  registerComponent,
} from "./component";
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

describe("bind", () => {
  test("attaches markup inserted after mount to the enclosing component", () => {
    document.body.innerHTML = `
      <div data-component="counter">
        <ul id="list"><li id="a" data-text="count"></li></ul>
        <button id="up" data-on="click:increment"></button>
      </div>
    `;
    mount();
    byId("up").click();

    byId("list").insertAdjacentHTML(
      "beforeend",
      `<li id="b"><span id="b-count" data-text="count"></span> <button id="up2" data-on="click:increment"></button></li>`,
    );
    // Not bound yet: the text is whatever the fragment carried.
    expect(byId("b-count").textContent).toBe("");

    bind(byId("b"));
    expect(byId("b-count").textContent).toBe("1");
    byId("up2").click();
    expect(byId("a").textContent).toBe("2");
    expect(byId("b-count").textContent).toBe("2");
  });

  test("releases late bindings with the component", () => {
    document.body.innerHTML = `
      <div data-component="counter"><ul id="list"></ul></div>
    `;
    const unmount = mount();
    byId("list").insertAdjacentHTML(
      "beforeend",
      `<li id="late" data-on="click:increment" data-text="count"></li>`,
    );
    bind(byId("late"));
    byId("late").click();
    expect(byId("late").textContent).toBe("1");

    unmount();
    byId("late").click();
    expect(byId("late").textContent).toBe("1");
  });

  test("mounts component roots inside the inserted markup", () => {
    document.body.innerHTML = `<div id="host"></div>`;
    byId("host").insertAdjacentHTML(
      "beforeend",
      `<section id="frag"><div data-component="counter"><span id="c" data-text="count"></span></div></section>`,
    );

    bind(byId("frag"));
    expect(byId("c").textContent).toBe("0");
  });

  test("is a plain mount when the element is itself a component root", () => {
    document.body.innerHTML = `<div id="host"></div>`;
    byId("host").insertAdjacentHTML(
      "beforeend",
      `<div id="root" data-component="counter"><span id="c" data-text="count"></span></div>`,
    );

    bind(byId("root"));
    expect(byId("c").textContent).toBe("0");
    expect(byId("root").hasAttribute(MOUNTED_ATTR)).toBe(true);
  });

  test("does nothing for markup outside any mounted component", () => {
    document.body.innerHTML = `<span id="loose" data-text="count">kept</span>`;
    expect(() => bind(byId("loose"))).not.toThrow();
    expect(byId("loose").textContent).toBe("kept");
  });
});

describe("mount errors", () => {
  test("names the component and attribute for an unknown binding", () => {
    document.body.innerHTML = `
      <div data-component="counter"><span data-text="missing"></span></div>
    `;
    expect(() => mount()).toThrow(
      '[counter] data-text="missing" must name a signal, computed or perElement',
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

  test("rejects value on a checkbox or a radio", () => {
    document.body.innerHTML = `
      <div data-component="counter"><input type="checkbox" data-value="label" /></div>
    `;
    expect(() => mount()).toThrow(/data-value="label" cannot bind a checkbox/);

    document.body.innerHTML = `
      <div data-component="counter"><input type="radio" data-value="label" /></div>
    `;
    expect(() => mount()).toThrow(/data-value="label" cannot bind a radio/);
  });
});

describe("data-show and the display property", () => {
  test("hides with an inline display, which no stylesheet can outrank", () => {
    document.body.innerHTML = `
      <div data-component="counter">
        <p id="hint" data-show="isPositive">Something</p>
      </div>
    `;
    mount();

    // `hidden` alone would leave a `.hint { display: flex }` rule winning, so
    // the directive writes the inline property too.
    const hint = byId("hint");
    expect(hint.hidden).toBe(true);
    expect(hint.style.display).toBe("none");
  });

  test("restores the inline display the element arrived with", () => {
    document.body.innerHTML = `
      <div id="root" data-component="counter">
        <span id="count" data-text="count"></span>
        <p id="plain" data-show="isPositive">Plain</p>
        <p id="styled" data-show="isPositive" style="display: grid">Styled</p>
        <button id="up" data-on="click:increment">+</button>
      </div>
    `;
    mount();

    const plain = byId("plain");
    const styled = byId("styled");
    expect(plain.style.display).toBe("none");
    expect(styled.style.display).toBe("none");

    byId<HTMLButtonElement>("up").click();
    expect(plain.hidden).toBe(false);
    // Back to no inline display at all, so the stylesheet decides again.
    expect(plain.style.display).toBe("");
    expect(styled.hidden).toBe(false);
    expect(styled.style.display).toBe("grid");
  });
});

describe("perElement", () => {
  const chips = defineComponent("chips", () => {
    const team = signal("");
    return {
      // One binding for a row of elements the server built from data: there is
      // no name per chip to give data-class, so the chip says which it is.
      isSelected: perElement((el) => (el.dataset.chip ?? "") === team.value),
      selectedLabel: perElement((el) =>
        (el.dataset.chip ?? "") === team.value ? "selected" : "",
      ),
      select: (event: Event) => {
        const el = event.currentTarget as HTMLElement;
        team.set(el.dataset.chip ?? "");
      },
    };
  });
  registerComponent(chips);

  const fixture = `
    <div data-component="chips">
      <button id="all" data-chip="" data-on="click:select"
              data-class="active:isSelected" data-attr="aria-pressed:isSelected"></button>
      <button id="design" data-chip="Design" data-on="click:select"
              data-class="active:isSelected" data-attr="aria-pressed:isSelected"></button>
      <button id="growth" data-chip="Growth" data-on="click:select"
              data-class="active:isSelected" data-attr="aria-pressed:isSelected"></button>
      <span id="label" data-chip="Design" data-text="selectedLabel"></span>
    </div>
  `;

  test("is read once per bound element, with that element", () => {
    document.body.innerHTML = fixture;
    mount();

    expect(byId("all").classList.contains("active")).toBe(true);
    expect(byId("design").classList.contains("active")).toBe(false);
    expect(byId("all").getAttribute("aria-pressed")).toBe("true");
    expect(byId("growth").getAttribute("aria-pressed")).toBe("false");
  });

  test("every bound element follows the signal it read", () => {
    document.body.innerHTML = fixture;
    mount();

    byId<HTMLButtonElement>("design").click();
    expect(byId("design").classList.contains("active")).toBe(true);
    expect(byId("all").classList.contains("active")).toBe(false);
    expect(byId("design").getAttribute("aria-pressed")).toBe("true");
    expect(byId("label").textContent).toBe("selected");

    byId<HTMLButtonElement>("growth").click();
    expect(byId("growth").classList.contains("active")).toBe(true);
    expect(byId("design").classList.contains("active")).toBe(false);
    expect(byId("label").textContent).toBe("");
  });

  test("works for show and prop as well as class, attr and text", () => {
    const gated = defineComponent("gated", () => {
      const open = signal(false);
      return {
        matches: perElement(
          (el) => (el.dataset.when === "open") === open.value,
        ),
        toggle: () => open.set(!open.value),
      };
    });
    registerComponent(gated);

    document.body.innerHTML = `
      <div data-component="gated">
        <p id="shut" data-when="shut" data-show="matches"></p>
        <p id="opened" data-when="open" data-show="matches"></p>
        <button id="flip" data-when="open" data-on="click:toggle"
                data-prop="disabled:matches"></button>
      </div>
    `;
    mount();

    expect(byId("shut").hidden).toBe(false);
    expect(byId("shut").style.display).toBe("");
    expect(byId("opened").hidden).toBe(true);
    expect(byId("opened").style.display).toBe("none");
    expect(byId<HTMLButtonElement>("flip").disabled).toBe(false);

    byId<HTMLButtonElement>("flip").click();
    expect(byId("shut").hidden).toBe(true);
    expect(byId("shut").style.display).toBe("none");
    expect(byId("opened").hidden).toBe(false);
    expect(byId("opened").style.display).toBe("");
    expect(byId<HTMLButtonElement>("flip").disabled).toBe(true);
  });

  test("an action named where a readable belongs still throws", () => {
    // The reason perElement is a wrapper and not a bare function: both are
    // callable, so nothing at runtime could tell an action apart from one.
    document.body.innerHTML = `
      <div data-component="chips"><span data-text="select"></span></div>
    `;
    expect(() => mount()).toThrow(
      '[chips] data-text="select" must name a signal, computed or perElement',
    );
  });

  test("a perElement named where an action belongs still throws", () => {
    document.body.innerHTML = `
      <div data-component="chips"><button data-on="click:isSelected"></button></div>
    `;
    expect(() => mount()).toThrow(
      '[chips] data-on="isSelected" must name an action',
    );
  });
});
