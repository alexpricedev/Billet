import { describe, expect, test } from "bun:test";
import type { Readable, Signal } from "@client/reactive/signal";
import {
  ATTR,
  bindings,
  type ComponentDefinition,
  formatPairs,
  type PerElement,
  parsePairs,
} from "./attributes";

describe("parsePairs", () => {
  test("splits space-separated target:name pairs", () => {
    expect(parsePairs("open:isOpen  active:isActive")).toEqual([
      ["open", "isOpen"],
      ["active", "isActive"],
    ]);
  });

  test("splits on the last colon so a colon in the target survives", () => {
    expect(parsePairs("md:flex:isWide")).toEqual([["md:flex", "isWide"]]);
  });

  test("ignores surrounding whitespace", () => {
    expect(parsePairs("  click:toggle \n")).toEqual([["click", "toggle"]]);
  });

  test("rejects a token without both halves", () => {
    expect(() => parsePairs("toggle")).toThrow(/target:name/);
    expect(() => parsePairs(":toggle")).toThrow(/target:name/);
    expect(() => parsePairs("click:")).toThrow(/target:name/);
  });

  test("round-trips formatPairs", () => {
    const map = { "aria-expanded": "isOpen", "aria-busy": "isBusy" };
    expect(parsePairs(formatPairs(map))).toEqual(Object.entries(map));
  });
});

describe("bindings()", () => {
  type Demo = ComponentDefinition<
    "demo",
    {
      query: Signal<string>;
      isOpen: Readable<boolean>;
      isSelected: PerElement<boolean>;
      toggle: () => void;
    }
  >;
  const demo = bindings<Demo>("demo");

  test("root carries the component name", () => {
    expect(demo.root).toEqual({ [ATTR.component]: "demo" });
  });

  test("single-name bindings emit the bare name", () => {
    expect(demo.text("isOpen")).toEqual({ [ATTR.text]: "isOpen" });
    expect(demo.show("isOpen")).toEqual({ [ATTR.show]: "isOpen" });
    expect(demo.value("query")).toEqual({ [ATTR.value]: "query" });
  });

  test("map bindings emit target:name pairs", () => {
    expect(demo.class({ open: "isOpen" })).toEqual({
      [ATTR.class]: "open:isOpen",
    });
    expect(demo.attr({ "aria-expanded": "isOpen" })).toEqual({
      [ATTR.attr]: "aria-expanded:isOpen",
    });
    expect(demo.prop({ disabled: "isOpen" })).toEqual({
      [ATTR.prop]: "disabled:isOpen",
    });
    expect(demo.on({ click: "toggle", keydown: "toggle" })).toEqual({
      [ATTR.on]: "click:toggle keydown:toggle",
    });
  });

  // A perElement is read like any other readable, so it belongs wherever a
  // signal or computed does — and nowhere an action does. These are compile
  // -time assertions as much as runtime ones: the @ts-expect-error lines fail
  // `bun run typecheck` if the key types ever stop discriminating.
  test("a perElement is accepted wherever a readable is", () => {
    expect(demo.text("isSelected")).toEqual({ [ATTR.text]: "isSelected" });
    expect(demo.show("isSelected")).toEqual({ [ATTR.show]: "isSelected" });
    expect(demo.class({ active: "isSelected" })).toEqual({
      [ATTR.class]: "active:isSelected",
    });
    expect(demo.attr({ "aria-pressed": "isSelected" })).toEqual({
      [ATTR.attr]: "aria-pressed:isSelected",
    });
    expect(demo.prop({ disabled: "isSelected" })).toEqual({
      [ATTR.prop]: "disabled:isSelected",
    });
  });

  test("the three roles stay separate in the type", () => {
    // An action is not a readable.
    // @ts-expect-error
    demo.text("toggle");
    // A perElement is not an action.
    // @ts-expect-error
    demo.on({ click: "isSelected" });
    // `value` writes back, so it needs a string signal, not a perElement.
    // @ts-expect-error
    demo.value("isSelected");
    expect(demo.value("query")).toEqual({ [ATTR.value]: "query" });
  });
});
