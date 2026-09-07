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

import {
  type Action,
  ATTR,
  type Bindings,
  type ComponentDefinition,
  type ComponentFactory,
  MOUNTED_ATTR,
  parsePairs,
} from "./attributes";
import {
  effect,
  isReadable,
  isSignal,
  type Readable,
  runScope,
} from "./signal";

const registry = new Map<string, ComponentDefinition<string, Bindings>>();

// Roots that currently have a live component, so a second `mount` over the
// same subtree (after a fragment swap, say) doesn't double-bind them.
const mounted = new WeakSet<Element>();

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
    if (!definition || mounted.has(root)) continue;

    mounted.add(root);
    const dispose = runScope(() => {
      const bindings = definition.factory(root);
      bind(root, definition.name, bindings);
    });
    root.setAttribute(MOUNTED_ATTR, "");

    disposers.push(() => {
      dispose();
      root.removeAttribute(MOUNTED_ATTR);
      mounted.delete(root);
    });
  }

  return () => {
    for (const dispose of disposers) dispose();
  };
}

// The root and its descendants, stopping at any nested component root: those
// elements belong to the inner component, whatever its name binds to.
function ownedElements(root: HTMLElement): HTMLElement[] {
  const owned: HTMLElement[] = [root];
  const visit = (parent: Element) => {
    for (const child of Array.from(parent.children)) {
      if (child.hasAttribute(ATTR.component)) continue;
      if (child instanceof HTMLElement) owned.push(child);
      visit(child);
    }
  };
  visit(root);
  return owned;
}

function bind(root: HTMLElement, name: string, bindings: Bindings): void {
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

  for (const el of ownedElements(root)) {
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
