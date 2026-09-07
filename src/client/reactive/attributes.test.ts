import { describe, expect, test } from "bun:test";
import {
  ATTR,
  type ComponentDefinition,
  component,
  formatPairs,
  parsePairs,
} from "./attributes";
import type { Readable, Signal } from "./signal";

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

describe("component()", () => {
  type Demo = ComponentDefinition<
    "demo",
    {
      query: Signal<string>;
      isOpen: Readable<boolean>;
      toggle: () => void;
    }
  >;
  const demo = component<Demo>("demo");

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
});
