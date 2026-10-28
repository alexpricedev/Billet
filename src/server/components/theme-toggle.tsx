/**
 * Cycles System → Light → Dark and remembers the choice in the browser.
 *
 * Tier 3 (presentation over what the server already rendered): with JavaScript
 * off the page is still *correct* — `base.css` follows `prefers-color-scheme`,
 * so the reader gets their OS theme. All this adds is the ability to override
 * it, which is interface state for one browser, never domain data. That is why
 * it may live on the client at all; see CLAUDE.md, "Client code has three tiers".
 *
 * Shipped `hidden` and unhidden by `src/client/components/theme-toggle.ts`, the
 * same way the nav's menu button is: a page with no bundle — every error page —
 * must not render a control that does nothing. The theme *itself* still applies
 * there, because the inline script in `layouts.tsx` runs before first paint.
 *
 * All three icons are rendered and the script shows one. Swapping an icon by
 * building markup on the client is what `boundaries.test.ts` exists to prevent.
 */
export const ThemeToggle = () => (
  <button
    type="button"
    className="theme-toggle"
    data-theme-toggle
    aria-label="Theme: system"
    hidden
  >
    <svg
      className="theme-icon"
      data-theme-icon="system"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <rect width="20" height="14" x="2" y="3" rx="2" />
      <path d="M8 21h8" />
      <path d="M12 17v4" />
    </svg>
    <svg
      className="theme-icon"
      data-theme-icon="light"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      hidden
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
    <svg
      className="theme-icon"
      data-theme-icon="dark"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      hidden
    >
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  </button>
);
