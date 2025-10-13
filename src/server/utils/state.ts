import type { BunRequest } from "bun";
import { getFlashCookie, setFlashCookie } from "./flash";

export const stateHelpers = <T>() => ({
  /**
   * Get flash state from cookie and automatically delete it
   * Used in GET handlers to retrieve temporary state passed via redirect
   */
  getFlash: (req: BunRequest): T => {
    return getFlashCookie<T>(req, "state");
  },

  /**
   * Set flash state in cookie before redirect
   * Used in POST handlers to pass temporary state to the next page
   */
  setFlash: (req: BunRequest, state: T): void => {
    setFlashCookie<T>(req, "state", state);
  },
});
