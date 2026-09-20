// What a client test can and cannot see about whether an element is visible.
//
// These tests lift `<main>` out of a rendered page and drop it into happy-dom
// without the layout's stylesheet — deliberately, so no test fetches the bundle
// or the CSS. The consequence is that nothing in `bun run test` can evaluate a
// stylesheet: a rule in `base.css` or a page file is invisible here, and an
// assertion about how something *looks* can only ever be an assertion about the
// DOM.
//
// `data-show` is inside that limit because it writes an inline `display`
// alongside `hidden` (see `reactive/component.ts`), and both are DOM state. Use
// `isShown` rather than reading `.hidden` directly, so a test keeps failing if
// only one of the two is ever set.
//
// What is still out of reach, and needs `/browse` or `scripts/browser-smoke.test.ts`:
// anything gated by a stylesheet rather than by a binding — the `data-mounted`
// hook that hides JS-only controls until a component mounts, `.active` styling
// on a filter chip, layout, and every specificity interaction between a page
// file and `base.css`.

/** True when the element is not hidden by either half of `data-show`. */
export const isShown = (el: Element | null | undefined): boolean => {
  if (!(el instanceof HTMLElement)) return false;
  return !el.hidden && el.style.display !== "none";
};

/** True when `data-show` has hidden the element by both means. */
export const isHidden = (el: Element | null | undefined): boolean => {
  if (!(el instanceof HTMLElement)) return false;
  return el.hidden && el.style.display === "none";
};
