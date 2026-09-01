import type { BunRequest } from "bun";
import { rateLimit } from "../../middleware/rate-limit";
import { jsonError } from "../../utils/response";

/**
 * The guards every JSON endpoint runs before it reaches a service — the mirror
 * of `auth/form-guard.ts`, which does the same job for HTML forms.
 *
 * Each returns either the value the controller asked for or the Response to
 * send instead, so a controller reads as a list of short-circuits followed by
 * the happy path.
 */

/**
 * Per-IP budgets for the API, in requests per minute.
 *
 * Reads are cheap and a paging client makes several in a row, so they get the
 * wider budget; writes each cost a round trip that changes state. Both are far
 * looser than the auth forms' 5/minute — nothing here sends mail or burns an
 * argon2 hash — but they still cap what a single address can do to the
 * database, which is the point.
 *
 * Three separate buckets, and that separation is the budget: sharing one would
 * make reads spend the write allowance, and sharing the auth forms' would let
 * a handful of `/api/*` calls 429 the next `/login` from the same address.
 */
export const apiReadLimit = (req: BunRequest): Response | null =>
  rateLimit(req, "api-read", 60, 60_000);

export const apiWriteLimit = (req: BunRequest): Response | null =>
  rateLimit(req, "api-write", 20, 60_000);

export type JsonBodyResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: Response };

/**
 * Read a request body as JSON, or produce the response to send instead.
 *
 * Three failures a controller must not hand on to a service:
 *
 * 1. **The wrong `Content-Type`.** Anything but JSON is a 415 — a body we would
 *    have to guess at is a body we refuse, rather than one we parse and hope.
 * 2. **A body that isn't JSON at all.** `req.json()` throws on malformed input,
 *    and an uncaught throw reaches `handleGuarded`, which answers with the
 *    *HTML* 500 page and logs the request as an unhandled server error. A
 *    malformed body is the client's mistake and a 400 says so.
 * 3. **A JSON value that isn't an object.** `null`, `[]`, `"x"` and `3` all
 *    parse, and every one of them makes `body.title` either a type error or a
 *    silent `undefined` on its way into an INSERT.
 */
export const readJsonBody = async (
  req: BunRequest,
): Promise<JsonBodyResult> => {
  // Compare the media type alone — a charset or boundary parameter after the
  // `;` is the client's business, not a reason to reject.
  const mediaType = (req.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  // `application/json` plus the `+json` structured suffix (RFC 6839), which is
  // what a client sending a vendor media type will use.
  if (mediaType !== "application/json" && !mediaType.endsWith("+json")) {
    return {
      ok: false,
      response: jsonError(
        415,
        "unsupported_media_type",
        `This endpoint accepts application/json; received ${mediaType || "no Content-Type"}.`,
        { headers: { Accept: "application/json" } },
      ),
    };
  }

  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return {
      ok: false,
      response: jsonError(
        400,
        "invalid_json",
        "The request body could not be parsed as JSON.",
      ),
    };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      response: jsonError(
        400,
        "invalid_body",
        "The request body must be a JSON object.",
      ),
    };
  }

  return { ok: true, body: parsed as Record<string, unknown> };
};

export type IdResult =
  | { ok: true; id: number }
  | { ok: false; response: Response };

// Every id column in the schema is a `serial`, i.e. a Postgres int4. A larger
// number is not an id that could ever exist, and passing one through would make
// Postgres raise "out of range" — an exception, so an HTML 500 — where the
// client deserves to be told its input was wrong.
const MAX_SERIAL_ID = 2_147_483_647;

/**
 * Read the trailing `:id` path segment as a positive integer.
 *
 * The parse this replaces (`Number.parseInt(segment) || 0`) handed its result
 * straight to the service, so `/api/projects/invalid` queried the database for
 * `NaN` and answered the miss with a 404 — telling the client the project did
 * not exist, when in fact it had never named one.
 */
export const readIdParam = (req: BunRequest): IdResult => {
  const segment = new URL(req.url).pathname.split("/").pop() ?? "";
  // Deliberately stricter than `Number.parseInt`, which accepts "1.9", "1e3",
  // " 1" and "12abc" and quietly returns something for all four.
  const id = /^[1-9]\d*$/.test(segment) ? Number(segment) : Number.NaN;

  if (!Number.isSafeInteger(id) || id > MAX_SERIAL_ID) {
    return {
      ok: false,
      response: jsonError(
        400,
        "invalid_id",
        "The resource id must be a positive integer.",
      ),
    };
  }

  return { ok: true, id };
};

export const DEFAULT_PAGE_LIMIT = 25;
export const MAX_PAGE_LIMIT = 100;

export type PaginationResult =
  | { ok: true; limit: number; offset: number }
  | { ok: false; response: Response };

/**
 * Read `?limit=` and `?offset=` for a collection endpoint.
 *
 * Out-of-range input is rejected rather than clamped. Silently serving 100 rows
 * to a client that asked for 5000 looks like success and reads like a complete
 * answer — the client has no way to tell it got a page. A 400 naming the
 * maximum is the only response it can act on.
 */
export const readPagination = (req: BunRequest): PaginationResult => {
  const params = new URL(req.url).searchParams;

  const readNumber = (name: string, fallback: number): number => {
    const raw = params.get(name);
    if (raw === null || raw === "") return fallback;
    return /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  };

  const limit = readNumber("limit", DEFAULT_PAGE_LIMIT);
  const offset = readNumber("offset", 0);

  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) {
    return {
      ok: false,
      response: jsonError(
        400,
        "invalid_limit",
        `limit must be an integer between 1 and ${MAX_PAGE_LIMIT}.`,
        { fields: { limit: `Expected 1–${MAX_PAGE_LIMIT}.` } },
      ),
    };
  }

  if (!Number.isSafeInteger(offset)) {
    return {
      ok: false,
      response: jsonError(
        400,
        "invalid_offset",
        "offset must be a non-negative integer.",
        { fields: { offset: "Expected 0 or greater." } },
      ),
    };
  }

  return { ok: true, limit, offset };
};

/**
 * Read a required string field from a parsed body.
 *
 * Trims, because nobody means the surrounding spaces in a title — the opposite
 * call from `readPassword`, where whitespace is part of the value. Returns
 * `null` for a missing field, a non-string, or a value that was only spaces, so
 * the caller can answer with a field-level 400 rather than writing `undefined`
 * into a NOT NULL column.
 */
export const readStringField = (
  body: Record<string, unknown>,
  field: string,
): string | null => {
  const value = body[field];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};
