// The header and field names the client's fetch helper and the server agree
// on. One definition, imported by both, so a rename can't half-land. Like
// everything in src/shared/, no DOM and no Node imports.

// Sent by `submitForm` so a controller can answer with a rendered fragment
// (a row, a card) instead of the redirect a plain form post gets.
export const FRAGMENT_HEADER = "X-Fragment";

// The CSRF token travels as a header on enhanced requests and as a hidden
// field on plain form posts; `checkCsrf` reads the header first. On a 403 for
// a stale-but-authentic token, a fragment response carries a fresh token in
// the same header so the client can retry once.
export const CSRF_HEADER = "X-CSRF-Token";
export const CSRF_FIELD = "_csrf";
