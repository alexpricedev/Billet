const MOBILE = "(width <= 640px)";

export function init() {
  const nav = document.querySelector<HTMLElement>('[data-component="nav"]');
  const toggle = nav?.querySelector<HTMLButtonElement>(".nav-toggle");
  const menu = nav?.querySelector<HTMLElement>("#nav-menu");
  if (!nav || !toggle || !menu) return;

  // The button ships hidden so a page without this script never shows a control
  // that does nothing. Everything the CSS changes hangs off data-nav-enhanced,
  // which means the no-JS layout stays exactly as it was.
  toggle.hidden = false;
  nav.dataset.navEnhanced = "";

  const close = ({ refocus }: { refocus: boolean }) => {
    if (nav.dataset.open === undefined) return;
    delete nav.dataset.open;
    toggle.setAttribute("aria-expanded", "false");
    if (refocus) toggle.focus();
  };

  toggle.addEventListener("click", () => {
    if (nav.dataset.open !== undefined) {
      close({ refocus: false });
      return;
    }
    nav.dataset.open = "";
    toggle.setAttribute("aria-expanded", "true");
  });

  document.addEventListener("click", (event) => {
    if (!nav.contains(event.target as Node)) close({ refocus: false });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close({ refocus: true });
  });

  // Above the breakpoint the panel styling stops applying and the links are laid
  // out inline again. Drop the open state too, so coming back down to mobile
  // doesn't reveal a panel the user never opened.
  const mobile = window.matchMedia(MOBILE);
  mobile.addEventListener("change", (event) => {
    if (!event.matches) close({ refocus: false });
  });
}
