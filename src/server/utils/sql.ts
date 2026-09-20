/**
 * Binding helpers for the four Bun.SQL shapes that don't do what they look
 * like. `utils/database.ts` is the reading half (`hasAffectedRows`); this is
 * the writing half.
 *
 * `services/database.ts` guards every query, so a mistake here is a throw
 * rather than a corrupted row — but the guard can only say what is wrong. These
 * are the right answers, and `.claude/rules/database.md` has the reasoning.
 */

import { db } from "../services/database";
import { registerJsonbValue } from "./sql-guard";

export { isJsonbValue } from "./sql-guard";

/**
 * Declare a value destined for a `jsonb` column.
 *
 * Bun encodes a bound object into jsonb itself, so the object is what the
 * driver wants — this returns it untouched and only records the intent, which
 * is what stops the pool guard rejecting it as an accidental `[object Object]`.
 *
 * The signature is the other half of the protection: it does not accept a
 * string, so `jsonbValue(JSON.stringify(prefs))` fails typecheck rather than
 * storing a jsonb *string* — one long scalar that reads back as text and
 * matches no query, with no error at any layer.
 */
export const jsonbValue = <T extends object | unknown[] | null>(
  value: T,
): T => {
  if (value !== null) registerJsonbValue(value);
  return value;
};

/**
 * An `IN` list: `WHERE id IN ${inList(ids)}`.
 *
 * Bun turns an array passed to `db()` into a parameter list, which is the only
 * correct way to match a set — `= ANY(${ids})` binds the array as one
 * comma-joined value and fails inside the protocol.
 *
 * Empty throws rather than degrading, because `IN ()` is a Postgres syntax
 * error and a fragment has no way to mean "no rows". The caller knows whether
 * an empty set means an empty result or a skipped query; this doesn't.
 */
export const inList = (values: readonly unknown[]) => {
  if (values.length === 0) {
    throw new TypeError(
      "inList() was given an empty array, which would render `IN ()` — a syntax error. Short-circuit the query instead: an empty set of ids matches no rows.",
    );
  }
  return db(values as unknown[]);
};

/**
 * A literal for a `text[]` *column* — the one case an array is genuinely what
 * the column holds, and the one Bun has no encoding for. `sql.array()` is not
 * the answer: it double-quotes each element, so `['A']` arrives as `"A"` with
 * the quotes inside the value.
 *
 * Bind the result as an ordinary string and cast it: `${textArrayLiteral(tags)}::text[]`.
 * Postgres array syntax escapes backslash and double quote inside an element,
 * and quoting every element means a comma, a brace or an empty string in the
 * data can't change the shape of the literal.
 */
export const textArrayLiteral = (values: readonly string[]): string =>
  `{${values.map((value) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;
