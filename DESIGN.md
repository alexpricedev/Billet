# Billet design system

The visual language follows Vercel's dashboard and Geist guidelines: neutral surfaces, hairline
borders, one restrained accent, compact type, and precision over decoration. This file is the
source of truth for the decisions; the tokens live in `src/client/base.css` and components consume
them.

It is shared with [billet-cms](https://github.com/alexpricedev/billet-cms), which is where the
system was first written down. Where the two differ, the difference is noted here rather than left
to be discovered.

## Principles

1. **Borders before shadows.** Separation is a 1px line and a surface step. A shadow means the
   element genuinely floats (menu, dialog, popover).
2. **Quiet chrome, loud content.** Navigation and toolbars recede. The page title, the content, and
   the primary action are the only things that compete.
3. **One accent.** Blue marks links, focus and selection. It never fills a large surface, and
   status is never carried by colour alone.
4. **Compact by default.** 14px interface type, 32px controls, 40px table rows, tight gutters.
   Density is a feature.
5. **Honest states.** Disabled, saving, saved and error states are real, visible and specific. No
   fake success, no dead controls.
6. **System, then page.** Shared tokens and components first; a page may add layout, never a second
   palette or type scale.

## Colour tokens

Semantic tokens only. A component never introduces an arbitrary hex value. Both themes are defined
and the theme follows the OS — see "Theming" below.

| Token | Light | Dark | Meaning |
|---|---|---|---|
| `--canvas` | `#fafafa` | `#090909` | Page background, top bar |
| `--surface` | `#ffffff` | `#111111` | Cards, panels, popovers, main content |
| `--surface-subtle` | `#f5f5f5` | `#161616` | Inset blocks, code, table headers |
| `--surface-hover` | `#f2f2f2` | `#1c1c1c` | Hover and selected-neutral |
| `--surface-selected` | `#f0f0f0` | `#1f1f1f` | Current nav item, selected row |
| `--text` | `#171717` | `#ededed` | Primary text |
| `--text-secondary` | `#525252` | `#a3a3a3` | Supporting copy, labels |
| `--text-muted` | `#737373` | `#8f8f8f` | Metadata, helper text |
| `--text-disabled` | `#a3a3a3` | `#5c5c5c` | Reserved; see "Disabled" below |
| `--border` | `#e5e5e5` | `#292929` | Default hairline |
| `--border-strong` | `#d4d4d4` | `#3a3a3a` | Hover border, dividers that must read |
| `--border-control` | `#8f8f8f` | `#6a6a6a` | The edge of an input, select or textarea |
| `--accent` | `#0070f3` | `#3291ff` | Links, focus, selection |
| `--accent-hover` | `#005cc5` | `#5ba8ff` | Link hover |
| `--accent-soft` | `#eef6ff` | `#0f2237` | Focus ring fill, selected hint |
| `--success` | `#067647` | `#3dd68c` | Success text |
| `--warning` | `#b54708` | `#f5b544` | Attention text |
| `--danger` | `#b42318` | `#ff6b6b` | Errors and destructive actions |
| `--button-primary-bg` | `#171717` | `#ededed` | Primary button fill |
| `--button-primary-fg` | `#ffffff` | `#0a0a0a` | Primary button text |

Each status colour has a `-soft` surface and a `-border` to go with it.

**`--border-control` is Billet's, and the CMS has no equivalent.** WCAG 1.4.11 wants 3:1 for the
boundary that identifies a control, and `--border` is nowhere near it. Inputs draw `--border-control`
(3.23:1 light, 3.49:1 dark); `--border` stays for dividers, which nothing has to see.

Legacy aliases (`--color-bg`, `--color-surface`, `--color-text`, `--color-primary` and so on) map
onto these tokens, so older CSS cannot drift into a private palette. New CSS uses the semantic names.

### Status colours

Status always pairs colour with a word or a shape. Badges use a soft surface, a 1px border, the
status text colour and a leading dot; they are never a solid saturated pill. A `<tr class="done">`
is struck through as well as muted. Flash messages open with a bold status word.

## Typography

No webfont is loaded and none should be: every script and style is same-origin, which is what keeps
the CSP allowlist at `'self'`. The stack is the system UI face, with `Geist` first for a host that
happens to have it.

| Role | Size / line | Weight | Notes |
|---|---|---|---|
| Page title | 24px / 1.25 | 600 | `letter-spacing: -0.02em`, one per page |
| Section heading | 16px / 1.4 | 600 | `h2` |
| Component heading | 14px / 1.4 | 600 | `h3`, field group |
| Body | 14px / 1.5 | 400 | interface copy |
| Lead / intro | 15px / 1.65 | 400 | `.lead`, the sentence under a title |
| Form label | 13px / 1.4 | 500 | `--text`, not muted |
| Helper / metadata | 12px / 1.5 | 400 | `--text-muted` |
| Table header | 12px / 1.4 | 500 | sentence case, muted; no uppercase tracking |
| Code / identifier | 12px / 1.5 | 400 | mono, `--surface-subtle` chip |

Uppercase tracked labels are not used anywhere. (The CMS allows exactly one, an 11px group label in
its sidebar; Billet has no sidebar and so no exception.)

## Spacing, sizing, radii

4px base scale: `--space-1` 4, `--space-2` 8, `--space-3` 12, `--space-4` 16, `--space-5` 20,
`--space-6` 24, `--space-8` 32, `--space-10` 40, `--space-12` 48, `--space-16` 64.

- Top bar height: `--bar-height` 56px.
- Content max width: `--content-max` 1120px; vertical padding 32px desktop.
- Control height: `--control-height` 32px default, 28px compact (`.btn-sm`), 40px large
  (`.btn-lg`). Icon button 32×32. The height is a flat token, not derived from its parts.
- Card padding: 16px.
- Field gap: 16px between fields, 6px between a label, control, help and error.
- Table cell padding: 8px 12px.
- Radius: `--radius-sm` 6px (controls, badges), `--radius` 8px (cards, panels),
  `--radius-lg` 12px (the one auth card).
- Borders are 1px at `--border`; a hovered control moves to `--border-strong`, and a focused one to
  `--accent` plus a 3px `--accent-soft` ring.
- Icons: 20px in the bar, 24px inline. Stroke width 2. No emoji, no mixed icon families.

> **SVG attributes are kebab-case** (`stroke-width`, not `strokeWidth`). Preact passes camelCase
> through verbatim and the HTML parser ignores it — the stroke silently renders at the default
> width. `src/server/components/svg-attributes.test.ts` guards this.

## Elevation

`--shadow-sm` is for popovers and menus (the mobile nav panel is the only one), `--shadow-lg` for
dialogs. Nothing else. There are no gradients, glass effects, coloured glows or animated
backgrounds.

## Components

### Buttons

One box, explicit variants. The box is on the bare `button` element **and on every variant class**,
because the templates write `class="btn-ghost"` on its own — a variant left out of that selector
list silently loses its box.

| Class | Use |
|---|---|
| `.btn` / `.btn-secondary` | Default action: surface fill, hairline border |
| `.btn-primary` | The one committing action in a region |
| `.btn-ghost` | Quiet action in a toolbar or nav |
| `.btn-danger` | Destructive confirm — an outline, not a filled red block |
| `.btn-danger-solid` | Destructive confirm where the page is already the confirm step |
| `.btn-sm` / `.btn-lg` | 28px / 40px heights |

Icon-only buttons need `aria-label`. A button that navigates is an `<a>` with a button class, never
a styled `div`.

### Form controls

Inputs, selects and textareas share one box: `--input-bg` (the surface), a 1px `--border-control`,
`--radius-sm`, and `--control-height`. Text is 16px below 641px — which is what stops iOS Safari
zooming the viewport on focus — and 13.5px above it. Hover raises the border to `--text-muted`;
focus takes `--accent` plus a 3px `--accent-soft` ring, never an outline that shifts layout.
Invalid controls use `--danger` and `aria-invalid`, with the message adjacent.

`select` is the one control with a rule of its own, and it is the base rule's or nothing — it owns
the chevron, the RTL mirror, the list-box case and forced-colours. `boundaries.test.ts` fails the
suite if a page or component stylesheet writes a `select` rule.

A choice row — a radio or checkbox wrapped in its own `label` — is one flex row, so the control
centres on its text and the row shares the card's left edge. Group rows in a `.choice-group`.

### Disabled

One treatment, applied once: `opacity: 0.5` and `cursor: not-allowed`, from a single
`:is(input, select, textarea, button):disabled` rule. **The fade is the only mute.** Re-colouring
the text to `--text-disabled` as well faded it twice — roughly 1.9:1, against a disabled input's
6:1 — so a frozen control became unreadable rather than merely inactive. This is a deliberate
divergence from the CMS, which does both; `--text-disabled` is kept as a token but drawn nowhere.

### Cards and panels

`.card` / `.panel` is a bordered surface for a group of controls or a content item. Cards are for
things with a name and a destination — not for every paragraph. Plain sections with a heading and
a divider are preferred when the content does not need a boundary.

### Page header

`PageHeader` (`src/server/components/page-header.tsx`) is the top of every page: breadcrumb, title,
description, actions. Keeping it as one component is what makes page headers line up.

### Tables

`.data-table` for genuinely tabular data: hairline separators, muted sentence-case headers, tabular
numerals, and the row's subject in primary text. Below 640px a table either scrolls inside its own
bordered container or reflows to stacked rows (`/team` does the latter, via `data-label`).

### Badges

`.badge` with `data-tone="success" | "warning" | "danger" | "accent" | "neutral"`. Soft surface,
hairline border, 11.5px medium, and a leading dot so the tone is never colour alone.

### Alerts

`.flash-success`, `.flash-warning`, `.flash-error`: a soft surface, a matching border, a 3px
leading bar and a bold status word. No shadow. They appear directly under the page header.

### Empty states

`.empty-state` — a dashed, bordered block with a quiet title, one sentence, and a next action where
there is one. Never a bare "No results". The dashed edge is the only one in the system.

## Theming

Light is the unqualified `:root` palette. Dark arrives two ways:

1. `@media (prefers-color-scheme: dark) { :root:not([data-theme]) }` — the OS setting, which is
   what every page as shipped uses.
2. `:root[data-theme="dark"]` — an explicit choice, which beats the OS.

The two dark lists are physically duplicated, because plain CSS cannot put one declaration block
under both a media query and an attribute selector. `src/client/base-css.test.ts` compares them and
fails the suite if they drift.

The toggle in the top bar cycles System → Light → Dark and writes `data-theme` on `<html>`. The
choice is kept in `localStorage` under `billet-theme`, **not** on the server: it belongs to a
browser rather than an account, and a signed-out reader has no session to put it in. (The CMS
stores it per user instead — a `user_preferences` table and a radio group on its account page.
Either is reasonable; this is the one that needs no migration.)

**System is the absence of the attribute, not a value for it.** The OS media query is scoped to
`:root:not([data-theme])`, so writing `data-theme="system"` would match neither rule and strand the
page on the light palette. Going back to System removes the attribute and the storage key.

A small inline script in `<head>` (`layouts.tsx`) applies a stored choice **before the first
paint** — the bundle is deferred, so without it the reader would see the OS theme and watch it
swap. It is the one inline script in the project, which is why `script-src` keeps `'unsafe-inline'`.
The storage key is spelled in two places for that reason; `theme-toggle.test.tsx` pins both.

The control ships `hidden` and is revealed by its script, the same way the nav's menu button is: a
page with no bundle — every error page — must not render a control that does nothing. The theme
*itself* still applies there, because the inline script runs regardless.

The select chevron is a data URI, and a data URI cannot read a custom property — so the whole
`url()` is the token (`--select-chevron`) and each theme overrides it. Baking one theme's stroke
colour into the `select` rule is the defect this replaced.

## Interaction states

- Hover: a background step (`--surface-hover`) or a border step. **No movement** — nothing lifts,
  grows or translates.
- Active: one step darker than hover.
- Focus-visible: 2px `--accent` outline at 2px offset on every interactive element; form controls
  take the border-plus-ring treatment instead. Mouse focus does not show the ring.
- Selection: `[aria-current="page"]` or `.active` uses `--surface-selected` and primary text.
- Transitions: 120ms for colour and border. `prefers-reduced-motion` removes them all.

## Responsive behaviour

- 1120px+: content max width.
- 900px: the forms page's two columns collapse; main padding tightens.
- 640px: page padding 16px, header actions wrap under the title, the nav collapses to a toggled
  panel with 44px rows, tables scroll or reflow.
- 320px: no horizontal overflow. Every long unbroken token (URLs, ids, emails) wraps.

## Accessibility

`runbooks/ACCESSIBILITY.md` is the standard; this is the part the design system owns.

- Text and controls meet WCAG AA **in both themes** — a palette change means re-checking both.
- Status is never colour alone.
- Every form control has a label; icon-only controls have `aria-label`.
- The keyboard focus ring is never removed without an equally visible replacement.
- `prefers-reduced-motion` is respected.
- Appearance is invisible to `bun run test`: the client fixtures lift markup into happy-dom with no
  stylesheet, on purpose. Anything gated by a CSS rule is checked by `bun run test:browser` or by
  eye. A design change with a green `bun run test` has not been checked.

## Anti-patterns

- New hard-coded colours, or a second palette in one page's CSS.
- Gradients, glassmorphism, glows, animated blobs.
- Shadows on cards or inputs.
- Uppercase tracked labels.
- Pills for everything; 999px radius outside true badges.
- Wrapping every block of content in a card.
- Placeholder controls, dead links, faux loading spinners.
- Replacing server-rendered forms with client-side application state.
- Hiding errors behind visual polish, or relying on colour alone.
