// The theme override: System (follow the OS), Light or Dark, remembered in
// this browser. See the docblock on src/server/components/theme-toggle.tsx for
// why this is allowed to be client code at all.
//
// The storage key is read twice — here, and by the inline script in
// layouts.tsx that runs before first paint so a chosen theme never flashes the
// other one. Keep the two in step; `theme-toggle.test.ts` pins the name.
export const THEME_STORAGE_KEY = "billet-theme";

const ORDER = ["system", "light", "dark"] as const;
type Theme = (typeof ORDER)[number];

const isTheme = (value: string | null): value is Theme =>
  value !== null && (ORDER as readonly string[]).includes(value);

/** Storage throws in private modes and with cookies blocked; the toggle still
 *  works for the current page, it just doesn't persist. */
const read = (): Theme => {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : "system";
  } catch {
    return "system";
  }
};

const write = (theme: Theme): void => {
  try {
    if (theme === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Ignored on purpose — see read().
  }
};

/**
 * "system" is the *absence* of the attribute, not a value for it: base.css
 * scopes the OS media query to `:root:not([data-theme])`, so writing
 * `data-theme="system"` would match neither that nor the dark attribute rule
 * and strand the page on the light palette.
 */
const apply = (theme: Theme): void => {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
};

const label = (theme: Theme): string => `Theme: ${theme}`;

const render = (button: HTMLElement, theme: Theme): void => {
  button.setAttribute("aria-label", label(theme));
  button.setAttribute("title", label(theme));
  for (const icon of button.querySelectorAll<SVGElement>("[data-theme-icon]")) {
    // `hidden` is a property of HTMLElement, and an <svg> is an SVGElement —
    // `icon.hidden = true` sets a dead expando and leaves the attribute the
    // server wrote exactly where it was. The attribute is what the UA's
    // `[hidden] { display: none }` rule reads, so set that.
    if (icon.dataset.themeIcon === theme) icon.removeAttribute("hidden");
    else icon.setAttribute("hidden", "");
  }
};

export function init(): void {
  const button = document.querySelector<HTMLElement>("[data-theme-toggle]");
  if (!button) return;

  let theme = read();
  render(button, theme);
  // Only now is it a control that does something.
  button.hidden = false;

  button.addEventListener("click", () => {
    theme = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length] as Theme;
    apply(theme);
    write(theme);
    render(button, theme);
  });
}
