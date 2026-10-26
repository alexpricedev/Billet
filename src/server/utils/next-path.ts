/**
 * Where a signed-in user lands when a flow asked them to come back.
 *
 * `?next=` is how a page says "after sign-in, return here" — the CMS's sign-in
 * bounce is the case it exists for, but the rule is general. The value arrives
 * from a link and leaves in a `Location:` header once the user is signed in, so
 * it is attacker-controlled by nature. It is therefore accepted only as a
 * same-origin path, normalised before use, and refused when it names one of the
 * signed-out pages the visitor just came from.
 */

/**
 * The signed-out pages, which a signed-in visitor is redirected away from to
 * their `next` (see `guestPageContext`). A `next` naming one of these is an
 * infinite redirect: /login → next=/login → /login. The reset pages are here
 * for the same reason — password reset is not a `next` destination yet, so a
 * link pointing at one only loops.
 */
const GUEST_ONLY = ["/login", "/signup", "/forgot-password", "/reset-password"];

/** Longer than any destination needs, and short enough to sit in an email. */
const MAX_LENGTH = 1000;

/**
 * A same-origin path (with its query and fragment) to return to, or `null`.
 *
 * The returned value is the normalised one, never the raw input: `/a/../b`
 * becomes `/b`, and a percent-encoded path stays encoded. A raw CR or LF would
 * be header injection in a `Location`, so every control character and space is
 * refused outright rather than escaped — no legitimate destination contains
 * one.
 */
export const safeNextPath = (value: unknown): string | null => {
  if (typeof value !== "string") return null;

  const raw = value.trim();
  if (!raw || raw.length > MAX_LENGTH) return null;

  // A backslash is a path separator to browsers, so "/\evil.example" and
  // "\\evil.example" normalise into a scheme-relative URL in the parser. Refuse
  // the character rather than trust the normalisation.
  if (raw.includes("\\")) return null;

  // Control characters and whitespace. `\p{Cc}` covers the raw CR/LF that
  // would otherwise split a `Location` header; whitespace has no business
  // inside a path we were handed (surrounding spaces are trimmed above).
  if (/[\p{Cc}\s]/u.test(raw)) return null;

  // Must be a path, not an absolute or scheme-relative URL. Both are checked,
  // because "//host" passes `startsWith("/")`.
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;

  let url: URL;
  try {
    url = new URL(raw, "http://next.invalid");
  } catch {
    return null;
  }
  // Catches absolute URLs, scheme-relative URLs and "user:pass@host" forms that
  // survived the checks above.
  if (url.origin !== "http://next.invalid") return null;

  // Compare the pathname alone: a fragment never reaches the server, so
  // "/login#x" would loop forever with the hash reattached on every hop.
  if (
    GUEST_ONLY.some(
      (page) => url.pathname === page || url.pathname.startsWith(`${page}/`),
    )
  ) {
    return null;
  }

  return `${url.pathname}${url.search}${url.hash}`;
};

/**
 * Put a validated `next` back on a redirect to a signed-out page.
 *
 * Used when a submission fails and the visitor has to be sent back to the form:
 * the destination has to survive that round trip, or a retry after a typo
 * forgets where they were going.
 */
export const withNext = (
  href: string,
  next: string | null | undefined,
): string => {
  if (!next) return href;
  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}next=${encodeURIComponent(next)}`;
};
