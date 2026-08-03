import type { BunRequest } from "bun";
import { getFlashCookie, setFlashCookie } from "./flash";

// Browsers cap a cookie near 4096 bytes including name, signature and
// attributes. Stay well under it: an over-budget cookie is dropped silently,
// which would lose the message the user is meant to see.
export const FLASH_PAYLOAD_MAX_BYTES = 3000;

const encodedSize = (state: unknown): number =>
  encodeURIComponent(JSON.stringify(state)).length;

/**
 * Shrink flash state to fit the cookie budget.
 *
 * `trimmable` is ordered - the first field is sacrificed first. Fields outside
 * it (notably the marker that decides which message renders) are never touched,
 * so the user always sees the message even when long input can't be preserved.
 */
export const fitFlashState = <T>(
  state: T,
  trimmable: readonly (keyof T & string)[],
): T => {
  if (encodedSize(state) <= FLASH_PAYLOAD_MAX_BYTES) {
    return state;
  }

  const fitted = { ...state } as Record<string, unknown>;

  for (const field of trimmable) {
    const value = fitted[field];
    if (typeof value !== "string" || value.length === 0) {
      continue;
    }

    // Halve the field until it stops being the problem, then drop it outright.
    let candidate = value;
    while (
      candidate.length > 0 &&
      encodedSize(fitted) > FLASH_PAYLOAD_MAX_BYTES
    ) {
      candidate = candidate.slice(0, Math.floor(candidate.length / 2));
      fitted[field] = candidate;
    }

    if (candidate.length === 0) {
      delete fitted[field];
    }

    if (encodedSize(fitted) <= FLASH_PAYLOAD_MAX_BYTES) {
      break;
    }
  }

  return fitted as T;
};

export const stateHelpers = <T>() => ({
  getFlash: (req: BunRequest): T => {
    return getFlashCookie<T>(req, "state");
  },

  setFlash: (req: BunRequest, state: T): void => {
    setFlashCookie<T>(req, "state", state);
  },
});
