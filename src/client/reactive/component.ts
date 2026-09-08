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
  parsePairs,
} from "@shared/attributes";
import {
  effect,
  isReadable,
  isSignal,
  type Readable,
  runScope,
} from "./signal";

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

  const readable = (attr: string, key: string): Readable<unknown> => {
    const binding = bindings[key];
    if (!isReadable(binding)) {
      throw new Error(
        `[${name}] ${attr}="${key}" must name a signal or computed the component returned`,
      );
    }
    return binding;
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
      const source = readable(ATTR.text, text);
      effect(() => {
        const value = source.value;
        el.textContent = value == null ? "" : String(value);
      });
    }

    const show = el.getAttribute(ATTR.show);
    if (show !== null) {
      const source = readable(ATTR.show, show);
      effect(() => {
        el.hidden = !source.value;
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
        const source = readable(ATTR.class, key);
        effect(() => {
          el.classList.toggle(className, Boolean(source.value));
        });
      }
    }

    const attrs = el.getAttribute(ATTR.attr);
    if (attrs !== null) {
      for (const [attrName, key] of parsePairs(attrs)) {
        const source = readable(ATTR.attr, key);
        effect(() => {
          const next = source.value;
          if (next == null) el.removeAttribute(attrName);
          else el.setAttribute(attrName, String(next));
        });
      }
    }

    const props = el.getAttribute(ATTR.prop);
    if (props !== null) {
      for (const [propName, key] of parsePairs(props)) {
        const source = readable(ATTR.prop, key);
        effect(() => {
          (el as unknown as Record<string, unknown>)[propName] = source.value;
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
