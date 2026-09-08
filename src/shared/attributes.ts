// The attribute vocabulary a component speaks — shared by the server templates
// that write it and the client that reads it, so the two can't drift on a
// spelling. Like everything in src/shared/, it has no DOM and no Node
// dependency: both sides import it at runtime.
//
// Every attribute carries the *name* of something the component returned — a
// signal, a computed, or an action — never an expression. That is what keeps
// `'unsafe-eval'` out of the CSP, and it's what lets `bindings<T>()` typecheck
// the names in a template against the client's bindings type.
//
// Values are names, so the attribute grammar is tiny: a bare name for `text`,
// `show` and `value`, and space-separated `target:name` pairs for `class`,
// `attr`, `prop` and `on`. `parsePairs` splits on the *last* colon, so a class
// like `md:flex` on the left survives.

import type { Readable, Signal } from "@client/reactive/signal";

export type Action = (event: Event) => void;
export type Bindings = Record<string, Readable<unknown> | Action>;
export type ComponentFactory<B extends Bindings> = (root: HTMLElement) => B;

export interface ComponentDefinition<N extends string, B extends Bindings> {
  readonly name: N;
  readonly factory: ComponentFactory<B>;
}

export const ATTR = {
  component: "data-component",
  text: "data-text",
  show: "data-show",
  value: "data-value",
  class: "data-class",
  attr: "data-attr",
  prop: "data-prop",
  on: "data-on",
} as const;

// A component's root is marked once its factory has run, so CSS can key on
// it — the search box that does nothing without JavaScript is hidden until
// then, the way the nav toggle is.
export const MOUNTED_ATTR = "data-mounted";

export function parsePairs(raw: string): Array<[target: string, name: string]> {
  const pairs: Array<[string, string]> = [];
  for (const token of raw.split(/\s+/)) {
    if (!token) continue;
    const at = token.lastIndexOf(":");
    if (at <= 0 || at === token.length - 1) {
      throw new Error(`Expected "target:name" but got "${token}"`);
    }
    pairs.push([token.slice(0, at), token.slice(at + 1)]);
  }
  return pairs;
}

export function formatPairs(map: Record<string, string>): string {
  return Object.entries(map)
    .map(([target, name]) => `${target}:${name}`)
    .join(" ");
}

type BindingsOf<C> = C extends ComponentDefinition<string, infer B> ? B : never;

// The keys of a bindings type by what they hold, so `text` only accepts a
// readable and `on` only accepts an action. `value` is narrower still — it
// writes back, so it needs a string signal, not a computed.
type ReadableKey<B> = {
  [K in keyof B]: B[K] extends Readable<unknown> ? K : never;
}[keyof B] &
  string;
type WritableKey<B> = {
  [K in keyof B]: B[K] extends Signal<string> ? K : never;
}[keyof B] &
  string;
type ActionKey<B> = {
  [K in keyof B]: B[K] extends Action ? K : never;
}[keyof B] &
  string;

type EventName = keyof HTMLElementEventMap;

/**
 * Typed attribute builders for one component, for spreading onto JSX in a
 * server template. Named for what it returns — the template's bindings to a
 * client component — rather than "component", which already means the JSX
 * function on the server and the factory on the client. `C` is the type of the client's `defineComponent` result —
 * import it with `import type`, which erases at compile time, so the template
 * gets the component's binding names without the server loading its code.
 *
 *   const search = bindings<ProjectSearch>("project-search");
 *   <div {...search.root}>
 *     <input {...search.value("query")} />
 *     <p {...search.text("summary")} />
 *
 * A name that the component doesn't return is a type error in the template.
 */
export function bindings<C extends ComponentDefinition<string, Bindings>>(
  name: C["name"],
) {
  type B = BindingsOf<C>;
  return {
    root: { [ATTR.component]: name } as Record<string, string>,
    /** Set the element's text content from a readable. */
    text: (key: ReadableKey<B>) => ({ [ATTR.text]: key }),
    /** Hide the element (`hidden`) unless the readable is truthy. */
    show: (key: ReadableKey<B>) => ({ [ATTR.show]: key }),
    /** Two-way bind a form control's `value` to a string signal. */
    value: (key: WritableKey<B>) => ({ [ATTR.value]: key }),
    /** Toggle each class on the truthiness of its readable. */
    class: (map: Record<string, ReadableKey<B>>) => ({
      [ATTR.class]: formatPairs(map),
    }),
    /** Set each attribute from its readable; null or undefined removes it. */
    attr: (map: Record<string, ReadableKey<B>>) => ({
      [ATTR.attr]: formatPairs(map),
    }),
    /** Assign each DOM property from its readable (`disabled`, `checked`…). */
    prop: (map: Record<string, ReadableKey<B>>) => ({
      [ATTR.prop]: formatPairs(map),
    }),
    /** Call an action when the event fires on this element. */
    on: (map: Partial<Record<EventName, ActionKey<B>>>) => ({
      [ATTR.on]: formatPairs(map as Record<string, string>),
    }),
  };
}
