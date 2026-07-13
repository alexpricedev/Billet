# Accessibility Runbook

Billet ships a WCAG-aligned baseline in the framework layer: semantic
server-rendered HTML, programmatically labelled form controls, a keyboard focus
ring, reduced-motion support, screen-reader-announced flash messages, and
captioned data tables. Because everything renders on the server, assistive tech
gets the full, correct structure in the initial HTML response — no client JS
required.

This runbook covers what's already handled, what becomes **your**
responsibility once you build your own design language, the patterns to keep
following as you add pages, and how to verify it all. It's aligned to the
[Website Specification — Accessibility](https://specification.website/accessibility)
checklist (28 items).

## 1. What Billet ships (the baseline)

These are handled in the framework layer and apply to every page automatically:

| Concern | Where | Notes |
|---|---|---|
| Document language | `layouts.tsx` | `<html lang="en">` on both layouts |
| Semantic landmarks | `layouts.tsx` | `<header>` / `<nav>` / `<main>` / `<footer>` |
| Navigation semantics | `nav.tsx` | `aria-label="Main navigation"` + `aria-current="page"` |
| Native interactive elements | throughout | Real `<button>` / `<a>` / `<form>` — never `<div onclick>` |
| Labelled form controls | `form-field.tsx`, templates | Every input has an associated `<label>` (see §3) |
| Keyboard focus ring | `style.css` | Global `:focus-visible { outline }` — visible, keyboard-only |
| Reduced motion | `style.css`, `home.ts` | `prefers-reduced-motion` shrinks transitions and stops the hero animation looping |
| Announced flash messages | `flash.tsx` | `role="alert"` for errors, `role="status"` for success |
| Data tables | `data-table.tsx`, templates | `<caption>` + `scope="col"` header cells |
| Accessible authentication | magic-link login | No password puzzle or CAPTCHA; `autocomplete="email"`; paste allowed |
| Mobile inputs | `style.css` | Inputs are `font-size: 16px` so iOS Safari doesn't zoom on focus |
| Screen-reader-only text | `.sr-only` utility | `style.css` — visually hidden, still announced |

Icon-only SVGs (e.g. the hero) carry `aria-hidden="true"` and sit next to real
text, so there are no unnamed links or buttons.

## 2. Your responsibility (the design layer)

Billet ships a placeholder dark theme. The moment you replace it with your own
design language, these become yours to own — a framework can't decide them for
you:

- **Colour contrast** — text and meaningful UI must meet WCAG contrast against
  their background (4.5:1 for body text, 3:1 for large text and UI). Check every
  colour pair in your palette, not just the defaults. See
  [contrast](https://specification.website/spec/accessibility/color-contrast/)
  and the CSS
  [`contrast-color()`](https://specification.website/spec/accessibility/contrast-color/)
  function for dynamic backgrounds.
- **Focus ring visibility** — the global `:focus-visible` outline uses
  `--color-primary`. If you change the palette, confirm the ring stays clearly
  visible against every surface it can appear on. Never reintroduce
  `outline: none` without an equally visible replacement.
- **Forced colours mode** — Billet is dark-only and does not yet ship a
  `forced-colors` media block. If your design relies on background colours to
  convey meaning (e.g. status pills), add
  [forced-colours](https://specification.website/spec/accessibility/forced-colors/)
  handling so Windows High Contrast users don't lose it.
- **Touch targets** — the default buttons clear the 24×24 CSS px WCAG 2.2
  minimum but not the 44×44 enhanced target. Size your interactive controls
  accordingly.

## 3. Patterns to follow as you build

Keep the baseline intact by following these when you add pages:

- **Forms** — never rely on a placeholder as a label (it vanishes on input and
  is invisible to voice control). Wrap fields in `FormField` for a visible
  label, or add a `.sr-only` `<label htmlFor>` for compact/inline inputs (see
  the create form in `projects.tsx` and the search island in
  `project-search.tsx`).
- **Tables** — use the `DataTable` component, pass a `caption`, and give every
  header cell `scope="col"` (or `scope="row"`). Pass `captionVisible` if you
  want the caption shown rather than screen-reader-only.
- **Dynamic updates** — anything that appears after an action (validation
  errors, toasts, live results) should be announced. Reuse `Flash`, or render
  the container with `role="alert"` / `role="status"` / `aria-live`.
- **Links** — link text must describe its destination on its own. Avoid "click
  here" / "read more"; screen-reader users navigate by jumping between links.
- **Images** — every `<img>` needs an `alt` attribute (empty `alt=""` for purely
  decorative images). Decorative inline SVGs get `aria-hidden="true"`.
- **Motion** — respect `prefers-reduced-motion`. The global CSS block covers
  CSS animation/transition; for JS-driven animation (like the Lottie hero),
  gate autoplay on `matchMedia("(prefers-reduced-motion: reduce)")` as `home.ts`
  does.
- **Media** — video you add needs synchronised captions; audio-only content
  needs a transcript. Auto-captions alone aren't enough.
- **ARIA** — reach for a native HTML element first. Only add ARIA when nothing
  native fits ("the first rule of ARIA is don't use ARIA").
- **Never** add a third-party "accessibility overlay" widget — they don't work,
  harm screen-reader users, and attract lawsuits.

## 4. Known gaps

Deliberately not shipped in the template — add them if your product needs them:

- **Skip link** — no "skip to main content" link yet. If you grow the header/nav,
  add one as the first focusable element in `<body>` targeting `#main-content`
  (add the `id` to `<main>`). See
  [skip links](https://specification.website/spec/accessibility/skip-links/).
- **Forced colours mode** — see §2.
- **Captions / transcripts** — no media ships in the template; add these
  alongside any audio or video you introduce.

## 5. How to verify

Before you ship a new page or a redesign:

1. **Keyboard only** — unplug the mouse. Tab through the page: every control
   must be reachable, in a logical order, with a clearly visible focus ring, and
   no trap that holds focus.
2. **Reduce motion** — enable "Reduce motion" in your OS (macOS: System Settings
   → Accessibility → Display) and reload. Animations should be near-instant and
   the hero should not loop.
3. **Screen reader** — run VoiceOver (macOS: ⌘F5) or NVDA over a form: labels
   should be announced on focus, and a failed submit should announce the error.
4. **Automated pass** — run [axe DevTools](https://www.deque.com/axe/devtools/)
   or Lighthouse's Accessibility audit. Treat it as a floor, not a ceiling —
   automated tools catch roughly a third of issues.
5. **Contrast** — check your palette's colour pairs with a contrast checker (or
   the browser DevTools contrast readout) after any theme change.
