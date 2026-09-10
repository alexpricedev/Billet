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

`src/shared/` is the seam between the two sides: the attribute vocabulary, the header names in
`protocol.ts`, and copy both sides render (`todo.ts`). Both the server and the bundle import it at
runtime, so nothing in it may touch the DOM or import from `node:`.

Reads are `.value` on both signals and computeds; only a signal has `.set()`. A method rather than
a setter because TypeScript ignores `readonly` when checking assignability, so a computed would
otherwise pass wherever a writable signal is required — the `data-value` check depends on it.

Effects run synchronously when a signal is set, so a client test writes a signal or dispatches an
`input` event and asserts on the DOM on the next line. A component that is defined but never passed
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
