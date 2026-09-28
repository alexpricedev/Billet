import type { BunRequest } from "bun";
import { createCsrfToken } from "../services/csrf";
import { createGuestSession } from "../services/sessions";
import { createBunRequest } from "./bun-request";

const ORIGIN = process.env.APP_URL as string;

// Far enough back to land outside the two buckets that verify but inside the
// grace range, which is what makes a token "stale but authentic" — the state a
// tab left open produces, and the only CSRF failure these forms recover from.
const STALE_MS = 45 * 60 * 1000;

interface AuthFormOptions {
  /** Reuse a known session instead of minting a guest one. */
  sessionId?: string;
  /**
   * `undefined` mints a valid token, `false` omits the field the way a page
   * rendered before this existed would, and a string is sent verbatim.
   */
  csrf?: string | false;
  /** `null` sends no Origin header at all. */
  origin?: string | null;
  /**
   * The request URL, when it has to differ from the Origin — a forged Host
   * header is a legitimate thing to test, and it is not a CSRF failure.
   */
  url?: string;
}

/**
 * A POST at one of the signed-out auth forms carrying what a real browser
 * sends: the session cookie the GET set, an Origin, and a CSRF token bound to
 * that session and path.
 *
 * Import this *below* the `mock.module("../../services/database", …)` call in
 * a test file. It reaches the database through `services/csrf`, so the mock
 * has to be installed first — the same reason the service imports sit below
 * executable code in every other test here.
 */
export const authFormPost = async (
  path: string,
  formData: FormData,
  options: AuthFormOptions = {},
): Promise<BunRequest> => {
  const sessionId = options.sessionId ?? (await createGuestSession());

  if (options.csrf !== false) {
    formData.append(
      "_csrf",
      options.csrf ?? (await createCsrfToken(sessionId, "POST", path)),
    );
  }

  const origin = options.origin === undefined ? ORIGIN : options.origin;

  return createBunRequest(options.url ?? `${ORIGIN}${path}`, {
    method: "POST",
    headers: {
      cookie: `session_id=${sessionId}`,
      ...(origin ? { origin } : {}),
    },
    body: formData,
  });
};

/**
 * A token for `path` minted far enough in the past to be stale but still
 * verifiable — what an old tab submits. Mints against the clock rather than
 * forging a payload, so the test keeps testing the real token format.
 */
export const staleCsrfToken = async (
  sessionId: string,
  path: string,
): Promise<string> => {
  const realNow = Date.now;
  Date.now = () => realNow() - STALE_MS;
  try {
    return await createCsrfToken(sessionId, "POST", path);
  } finally {
    Date.now = realNow;
  }
};
