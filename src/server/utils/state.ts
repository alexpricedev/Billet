import type { BunRequest } from "bun";
import { getFlashCookie, setFlashCookie } from "./flash";

export const stateHelpers = <T>() => ({
  getFlash: (req: BunRequest): T => {
    return getFlashCookie<T>(req, "state");
  },

  setFlash: (req: BunRequest, state: T): void => {
    setFlashCookie<T>(req, "state", state);
  },
});
