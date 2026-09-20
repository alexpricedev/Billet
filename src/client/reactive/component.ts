// Components bind reactive state to markup the server already rendered. A
// factory receives its root element and returns bindings — signals, computeds
// and actions by name — and `mount` wires them to the `data-*` attributes under
// that root. Nothing here creates DOM: the template owns the markup, the
// component owns the state, and the attributes say which goes where.
//
// Registration mirrors `page-lifecycle.ts`: `defineComponent` describes one,
// `registerComponent` in `main.ts` makes it mountable, and a definition that is
// never registered never runs — the same quiet failure as a page that isn't
// registered, and worth the same care.
//
// Markup that arrives later — a row the server rendered in answer to a fetch —
// is not bound by `mount`, which ran before it existed. `bind(el)` attaches it
// to the component whose root encloses it, so a component that inserts a
// fragment calls `bind` on it and the fragment's attributes work like the rest.

import {
  type Action,
  ATTR,
  type Bindings,
  type ComponentDefinition,
  type ComponentFactory,
  MOUNTED_ATTR,
  PER_ELEMENT,
  type PerElement,
  parsePairs,
} from "@shared/attributes";
import { effect, isReadable, isSignal, runScope } from "./signal";

const registry = new Map<string, ComponentDefinition<string, Bindings>>();

// One live component per mounted root. Also what stops a second `mount` over
// the same subtree (after a fragment swap, say) from double-binding it.
interface Instance {
  readonly name: string;
  bindings: Bindings;
  readonly disposers: Array<() => void>;
}
const instances = new WeakMap<HTMLElement, Instance>();

export function defineComponent<N extends string, B extends Bindings>(
  name: N,
  factory: ComponentFactory<B>,
): ComponentDefinition<N, B> {
  return { name, factory };
}

export function registerComponent(
  definition: ComponentDefinition<string, Bindings>,
): void {
  registry.set(definition.name, definition);
}

/**
 * A readable that is evaluated once per bound element. Use it when the elements
 * carrying a directive are a list the server built from data — filter chips,
 * sortable column headers — so there is no binding name to give each one:
 *
 *   isSelected: ui.perElement((el) => el.dataset.team === team.value)
 *
 * and in the template, one name for all of them:
 *
 *   <button {...list.class({ active: "isSelected" })} data-team={team}>
 *
 * `read` runs inside that element's own effect, so signals it reads are
 * tracked the way a computed's are. It is not cached across elements — each
 * bound element gets its own effect and its own call.
 */
export function perElement<T>(read: (el: HTMLElement) => T): PerElement<T> {
  return { [PER_ELEMENT]: read };
}

function isPerElement(value: unknown): value is PerElement {
  return (
    typeof value === "object" &&
    value !== null &&
    PER_ELEMENT in (value as Record<symbol, unknown>)
  );
}

/**
 * Mount every registered component under `scope` (the whole document by
 * default). Returns a disposer that tears them all down again — effects,
 * listeners and the mounted marker — for callers that replace the subtree.
 */
export function mount(scope: ParentNode = document): () => void {
  const roots = Array.from(
    scope.querySelectorAll<HTMLElement>(`[${ATTR.component}]`),
  );
  if (scope instanceof HTMLElement && scope.hasAttribute(ATTR.component)) {
    roots.unshift(scope);
  }

  const disposers: Array<() => void> = [];
  for (const root of roots) {
    const definition = registry.get(root.getAttribute(ATTR.component) ?? "");
    if (!definition || instances.has(root)) continue;

    const instance: Instance = {
      name: definition.name,
      bindings: {},
      disposers: [],
    };
    instances.set(root, instance);
    instance.disposers.push(
      runScope(() => {
        instance.bindings = definition.factory(root);
        bindElements(instance, ownedElements(root));
      }),
    );
    root.setAttribute(MOUNTED_ATTR, "");

    disposers.push(() => {
      for (const dispose of instance.disposers) dispose();
      root.removeAttribute(MOUNTED_ATTR);
      instances.delete(root);
    });
  }

  return () => {
    for (const dispose of disposers) dispose();
  };
}

/**
 * Attach markup inserted after `mount` ran. `el` and its descendants bind to
 * the component whose root encloses them (their effects and listeners are
 * released with that component), and any component roots inside `el` are
 * mounted. Call it once on whatever a fragment response was inserted as.
 */
export function bind(el: HTMLElement): void {
  if (!el.hasAttribute(ATTR.component)) {
    const root = el.parentElement?.closest<HTMLElement>(`[${ATTR.component}]`);
    const instance = root ? instances.get(root) : undefined;
    if (instance) {
      instance.disposers.push(
        runScope(() => bindElements(instance, ownedElements(el))),
      );
    }
  }
  mount(el);
}

// The element and its descendants, stopping at any nested component root:
// those elements belong to the inner component, whatever its name binds to.
function ownedElements(el: HTMLElement): HTMLElement[] {
  const owned: HTMLElement[] = [el];
  const visit = (parent: Element) => {
    for (const child of Array.from(parent.children)) {
      if (child.hasAttribute(ATTR.component)) continue;
      if (child instanceof HTMLElement) owned.push(child);
      visit(child);
    }
  };
  visit(el);
  return owned;
}

function bindElements(instance: Instance, elements: HTMLElement[]): void {
  const { name, bindings } = instance;

  // Both kinds of readable collapse to "how do I read this for this element":
  // a signal or computed ignores the element, a perElement is handed it.
  const source = (
    attr: string,
    key: string,
  ): ((el: HTMLElement) => unknown) => {
    const binding = bindings[key];
    if (isReadable(binding)) return () => binding.value;
    if (isPerElement(binding)) return (el) => binding[PER_ELEMENT](el);
    throw new Error(
      `[${name}] ${attr}="${key}" must name a signal, computed or perElement the component returned`,
    );
  };
  const action = (attr: string, key: string): Action => {
    const binding = bindings[key];
    if (typeof binding !== "function") {
      throw new Error(
        `[${name}] ${attr}="${key}" must name an action the component returned`,
      );
    }
    return binding;
  };

  for (const el of elements) {
    const text = el.getAttribute(ATTR.text);
    if (text !== null) {
      const read = source(ATTR.text, text);
      effect(() => {
        const value = read(el);
        el.textContent = value == null ? "" : String(value);
      });
    }

    const show = el.getAttribute(ATTR.show);
    if (show !== null) {
      const read = source(ATTR.show, show);
      // `hidden` alone is not enough. It works through the user-agent rule
      // `[hidden] { display: none }`, which loses to *any* author `display:` on
      // the same element — so `.panel { display: flex }` leaves the panel open
      // however the signal is set, with no error anywhere. Hiding therefore
      // also writes an inline `display`, which no stylesheet can outrank, and
      // showing puts back whatever inline display the element arrived with
      // (usually none, which is what `""` restores).
      const inlineDisplay = el.style.display;
      effect(() => {
        const visible = Boolean(read(el));
        el.hidden = !visible;
        el.style.display = visible ? inlineDisplay : "none";
      });
    }

    const value = el.getAttribute(ATTR.value);
    if (value !== null) {
      const binding = bindings[value];
      if (!isSignal(binding) || !("value" in el)) {
        throw new Error(
          `[${name}] ${ATTR.value}="${value}" must name a signal, on a form control`,
        );
      }
      const control = el as HTMLInputElement;
      // A checkbox and a radio both carry a string `value`, so they clear the
      // guard above and then bind the wrong thing: writing the signal back
      // changes what the control *submits*, never what is checked. Checked
      // state is the browser's to submit and the server's to own.
      if (control.type === "checkbox" || control.type === "radio") {
        throw new Error(
          `[${name}] ${ATTR.value}="${value}" cannot bind a ${control.type} — use ${ATTR.prop}="checked:…" and ${ATTR.on}`,
        );
      }
      effect(() => {
        const next = String(binding.value ?? "");
        if (control.value !== next) control.value = next;
      });
      effect(() => {
        const write = () => binding.set(control.value);
        control.addEventListener("input", write);
        return () => control.removeEventListener("input", write);
      });
    }

    const classes = el.getAttribute(ATTR.class);
    if (classes !== null) {
      for (const [className, key] of parsePairs(classes)) {
        const read = source(ATTR.class, key);
        effect(() => {
          el.classList.toggle(className, Boolean(read(el)));
        });
      }
    }

    const attrs = el.getAttribute(ATTR.attr);
    if (attrs !== null) {
      for (const [attrName, key] of parsePairs(attrs)) {
        const read = source(ATTR.attr, key);
        effect(() => {
          const next = read(el);
          if (next == null) el.removeAttribute(attrName);
          else el.setAttribute(attrName, String(next));
        });
      }
    }

    const props = el.getAttribute(ATTR.prop);
    if (props !== null) {
      for (const [propName, key] of parsePairs(props)) {
        const read = source(ATTR.prop, key);
        effect(() => {
          (el as unknown as Record<string, unknown>)[propName] = read(el);
        });
      }
    }

    const events = el.getAttribute(ATTR.on);
    if (events !== null) {
      for (const [eventName, key] of parsePairs(events)) {
        const handler = action(ATTR.on, key);
        // An effect with no reactive reads runs once; its cleanup is the
        // unsubscribe, so disposing the component removes the listener.
        effect(() => {
          el.addEventListener(eventName, handler);
          return () => el.removeEventListener(eventName, handler);
        });
      }
    }
  }
}
