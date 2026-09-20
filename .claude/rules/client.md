---
paths:
  - "src/client/**"
  - "src/shared/**"
---

# The client layer

Loaded when you open client or shared code. The always-on rule — three tiers, plain form by
default — is in CLAUDE.md; this is how the layer works.

## Client interactivity binds to the markup the server rendered

`src/client/reactive/` is the whole client framework: `signal.ts` (signal, computed, effect, batch),
`component.ts` (`defineComponent`, `registerComponent`, `mount`, `bind`) and `request.ts`
(`submit`, `parse`), with the `data-*` vocabulary in `src/shared/attributes.ts`. Components import
it as two namespaces — `import * as ui from "@client/reactive"` for state and binding, `import * as
server from "@client/reactive/request"` for the round trip — so framework calls read `ui.signal`
and `server.submit` and a component's own logic is what's left bare. `request.ts` is kept out of the
`ui` barrel on purpose: every enhanced form in the codebase is a `server.` call, one grep away. A
component is a factory that receives its root element and returns *named* signals,
computeds and actions; the template puts those names in `data-text`, `data-show`, `data-value`,
`data-class`, `data-attr`, `data-prop` and `data-on` attributes under a `data-component` root, and
`mount()` in `main.ts` wires them. The template owns the markup and the component owns the state —
no virtual DOM, nothing rendered twice, and the page without JavaScript is the same HTML.

The attributes carry **names, never expressions**. That is what keeps `'unsafe-eval'` out of the
CSP, and it is what makes the names checkable: a template builds them through
`bindings<T>("name")` from `attributes.ts`, where `T` is the component's exported type
(`import type` — erased, so the server never loads client code). A misspelt binding or component
name fails `bun run typecheck`.

A name has to exist before the data does, which is a problem when the elements carrying a
directive *are* the data — one chip per team, one header per sortable column. `ui.perElement`
is the answer: one binding, read once per bound element and handed that element.

```ts
isSelected: ui.perElement((el) => (el.dataset.chip ?? "") === team.value),
```

```tsx
<button data-chip={team} {...chips.class({ active: "isSelected" })} />
```

It reads inside that element's own effect, so signals it reads are tracked like a computed's,
and it works anywhere a readable does — `data-text`, `data-show`, `data-class`, `data-attr`,
`data-prop`. It is a wrapper object rather than a bare function on purpose: an action is a bare
function too, and nothing at runtime could tell them apart, so `data-text` naming an action
would quietly call it instead of throwing. Reach for it only when the elements are a list the
server built; three fixed filters are three named computeds and clearer for it.

`data-show` sets **both** `hidden` and an inline `display`. `hidden` alone works through the
user-agent rule `[hidden] { display: none }`, which loses to any author `display:` on the same
element — so a `.panel { display: flex }` would leave the panel open whatever the signal said,
with no error anywhere. Showing restores whatever inline display the element arrived with, so a
`style="display: grid"` in the template survives. The consequence for tests is below.

`src/shared/` is the seam between the two sides: the attribute vocabulary, the header names in
`protocol.ts`, and copy both sides render (`todo.ts`). Both the server and the bundle import it at
runtime, so nothing in it may touch the DOM or import from `node:`.

Reads are `.value` on both signals and computeds; only a signal has `.set()`. A method rather than
a setter because TypeScript ignores `readonly` when checking assignability, so a computed would
otherwise pass wherever a writable signal is required — the `data-value` check depends on it.

`data-value` is one control and one string signal, and deliberately nothing more. Checked state is
`data-prop="checked:…"` plus `data-on`: the browser submits it and the server owns it, so a signal
over a checkbox or a radio group would be domain data on the client — tier 3's line. Both types
carry a string `value`, so they would otherwise bind silently and write back to what the control
submits instead of what is checked; `bind` throws on them by name.

Effects run synchronously when a signal is set, so a client test writes a signal or dispatches an
`input` event and asserts on the DOM on the next line. What a client test *cannot* do is
evaluate a stylesheet: the fixtures lift `<main>` into happy-dom without the layout's CSS, on
purpose, so no test fetches the bundle. Assertions are about DOM state, never about appearance.
`data-show` stays inside that limit because both halves of it are DOM state — assert with
`isShown` / `isHidden` from `test-utils/visibility.ts` rather than reading `.hidden`, so a test
fails if only one half is ever set. Anything gated by a rule instead of a binding — the
`data-mounted` hook, `.active` styling, layout, specificity against `base.css` — is invisible
to `bun run test` and needs the `/browse` skill or `scripts/browser-smoke.test.ts`. A component that is defined but never passed
to `registerComponent` in `main.ts` never mounts — the same quiet failure as an unregistered page.

`mount` binds what is on the page when it runs. Markup that arrives later — a row the server returned
to a fetch — is bound by `bind(el)`, which attaches it to the enclosing component and mounts any
component roots inside it. Insert a fragment without calling `bind` and its `data-on` does nothing;
`todo-list.ts` is the pattern to copy.
`data-component` is also a plain CSS hook on `<body>` and the nav; a root whose name has no
registered component is skipped, and bindings inside a nested `data-component` belong to that
inner root.

No Web Components. Shadow DOM and custom-element lifecycles need browser infrastructure to test;
pure functions and these components are both testable under `bun:test`.

## Two components share nothing but the DOM

A component's signals belong to its instance. There is no store, no context and no way for one
component to read another's state — including a nested one, whose root is inside the outer
component's markup. That is deliberate: a shared store is the first thing a client application
grows, and the seam it opens is the one this layer exists to keep closed.

When a nested component changes something the outer one counts or summarises, say so with a
bubbling `CustomEvent`, registered in an effect so the listener is released with the component:

```ts
// the nested component, after inserting a fragment
root.dispatchEvent(new CustomEvent(COMMENT_ADDED, { bubbles: true }));

// the outer one
ui.effect(() => {
  root.addEventListener(COMMENT_ADDED, recount);
  return () => root.removeEventListener(COMMENT_ADDED, recount);
});
```

The event name is a constant both sides import, the same way `protocol.ts` holds the header
names. Never hoist the state into a module to avoid the event: module-level state outlives the
page, is shared by every test file in a process, and turns two components into one.

## A failed enhanced post reports where the user is looking

`server.submit` rejects with a `RequestError` carrying the status. What to do with it depends
on one question: **does the form hold something the user typed?**

If it does not — a toggle, a delete, a one-word title — fall back to the plain post. The page
reloads, the server renders its flash, and nothing is lost. `todo-list.ts` is the pattern:

```ts
catch { form.submit(); }
```

If it does — a comment box, a long description, a form the user is halfway through — falling
back **destroys their work**. `form.submit()` reloads the page and takes the draft with it, and
it does that in response to a failure that was usually recoverable. Show the error in place
instead: a signal holding the message, `data-show` on a `role="alert"` element beside the
field, and the form left exactly as it was.

```ts
catch (failure) {
  error.set(messageFor(failure));   // 400, 401/403 and network each get their own sentence
}
```

Either way the plain form still works without JavaScript, so this is a choice about the
enhanced path only. Write which one you chose, and why, in the comment on the component.

## The tiers in detail, and the fence

The server owns state and rendering. The client owns two things: presentation of state already on
the page, and intercepting a form the page could have posted anyway. The test to apply before
writing any client code: *if JavaScript were off, would this be wrong, or merely slower?* Wrong
means it is server work. Slower is the only case where enhancement is a candidate.

1. **Plain form, redirect, flash.** The default for every mutation. Needs no justification.
2. **Enhanced form.** The same form and controller, answered with a fragment. Only when a reload
   would lose context the user is actively holding — a list they are working through, a filter they
   set. Write the reason in a comment on the component.
3. **Presentation over rows already rendered.** Show, hide, count, filter. Signals hold interface
   state for one page view, never domain data.

`src/client/boundaries.test.ts` is the fence, and it fails the suite rather than a review: no
`fetch`, markup building, `JSON.parse`, routing or storage in client code outside
`reactive/request.ts`; no runtime imports across the server/client line in either direction (types
cross freely); nothing in `src/shared/` touches the DOM or `node:`; and the built `main.js` stays
under a byte budget. Raise the budget or add an exemption only with the reason written next to it —
the number moving is the signal that something is being built on the client that belongs on the
server. Optimistic updates, client-side templates and client routing are not tiers; they are the
client application this project exists to not become.

## The stylesheet order is the import order

`src/client/style.css` is a manifest of `@import` lines and nothing else — `base.css` (tokens,
element defaults, shared utilities), then `components/`, then `pages/`. `@import` is hoisted above
every other rule in a file, so a rule written into `style.css` would land *after* every imported
one and silently win ties against the pages and components it appears to precede. Keeping the entry
to imports is what makes the order on screen the order in the cascade, and `boundaries.test.ts`
fails the suite if a rule goes back in. New page CSS goes in `pages/` with its `@import` in the
page group; anything global goes in `base.css`.
