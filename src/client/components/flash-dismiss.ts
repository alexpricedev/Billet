/**
 * Let the reader close a Flash banner.
 *
 * The × ships `hidden` in `components/flash.tsx`, so a page without this
 * script shows the banner and no control that does nothing. Revealing it is
 * the whole of the enhancement: the button removes the banner from this page
 * view and nothing else. There is no storage and no request, so a reload puts
 * the banner back — closing it is presentation, not a decision to remember.
 */
export const init = (): void => {
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-flash-dismiss]",
  )) {
    button.hidden = false;
    button.addEventListener("click", () => {
      button.closest(".flash")?.remove();
    });
  }
};
