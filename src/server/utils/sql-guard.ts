/**
 * The parameter guard `services/database.ts` wraps its pool with, and the
 * registry `jsonbValue()` writes to.
 *
 * A leaf on purpose: it imports nothing. `utils/sql.ts` needs `db` to build an
 * `IN` fragment and `db` needs the guard, so the two would form a cycle if the
 * guard lived beside the helpers. Everything a caller should reach for is
 * re-exported from `utils/sql.ts`; this module is the seam.
 */

import type { SQL } from "bun";

/**
 * Objects the caller has declared destined for a `jsonb` column.
 *
 * Registered rather than wrapped: Bun encodes jsonb correctly only from the raw
 * object, so there is nothing a wrapper could hand the driver. Weak, so
 * declaring a value costs no retention.
 */
const jsonbValues = new WeakSet<object>();

export const registerJsonbValue = (value: object): void => {
  jsonbValues.add(value);
};

export const isJsonbValue = (value: object): boolean => jsonbValues.has(value);

/**
 * A tagged-template call has a strings array carrying `raw`; every other call
 * shape — `db(array)` for an `IN` list, `db(object)` for an insert helper — is
 * Bun building a fragment, and its argument is the fragment's contents rather
 * than a bound parameter. Only the first form has parameters to check.
 */
export const isTaggedTemplate = (
  first: unknown,
): first is TemplateStringsArray => Array.isArray(first) && "raw" in first;

const isPlainObject = (value: object): boolean => {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/**
 * Why a bound value can't be trusted to Bun unexamined.
 *
 * Two of the parameter types JavaScript makes it easiest to reach for arrive at
 * Postgres as something else entirely, and neither costs an error:
 *
 *     an array  — ["a", "b"]  arrives as the string "a,b"
 *     an object — { a: 1 }   arrives as the string "[object Object]"
 *
 * The array in an `= ANY()` call is that mistake wearing the syntax that looks
 * most correct, and there Postgres answers `insufficient data left in message`
 * — an error naming neither the parameter nor the query. The object is worse:
 * silent at every layer, and what lands in the column is a nine-character
 * constant that matches no row and reads back as data.
 *
 * An object *is* right when the column is `jsonb`, and Bun encodes it
 * correctly. There is no schema here to consult, so the caller naming the
 * intent through `jsonbValue()` is the only thing separating the two cases.
 *
 * Returns the reason a value is unsafe, or null when it is fine. Primitives,
 * null, Date, Buffer and Bun's own `SQLHelper` fragments all pass — a fragment
 * is a class instance, so it is not a plain object.
 */
export const bindingFault = (value: unknown): string | null => {
  if (Array.isArray(value)) {
    return "an array binds as a comma-joined string, not a Postgres array. Interpolate `inList(values)` for an IN list, or `textArrayLiteral(values)` for a text[] column. Both are in utils/sql.ts";
  }
  if (typeof value === "object" && value !== null && isPlainObject(value)) {
    if (isJsonbValue(value)) return null;
    return 'a plain object binds as the string "[object Object]" unless the column is jsonb. If it is jsonb, wrap it in `jsonbValue(obj)` from utils/sql.ts — and never JSON.stringify it, which stores a jsonb string instead';
  }
  return null;
};

/**
 * Throw on the first unsafe parameter, naming its position the way Postgres
 * numbers placeholders so the message lines up with the query being debugged.
 */
export const assertSafeBindings = (values: unknown[]): void => {
  for (const [index, value] of values.entries()) {
    const fault = bindingFault(value);
    if (fault) {
      throw new TypeError(`Unsafe SQL parameter $${index + 1}: ${fault}`);
    }
  }
};

/**
 * Wrap a pool so every tagged template it runs has its parameters checked.
 *
 * A `Proxy` rather than a hand-written tag: Bun overloads the call — a tagged
 * template, `db(array)` for an `IN` list, `db(object)` for an insert helper —
 * and the `apply` trap forwards all three untouched while leaving `db.begin`,
 * `db.close` and the rest of the surface exactly as they were. Nothing has to
 * import a different name to be covered.
 *
 * `test-utils/database.ts` wraps its pools the same way, so a query that throws
 * in production throws in a test rather than passing there and failing live.
 */
export const guardPool = (pool: SQL): SQL =>
  new Proxy(pool, {
    apply(target, _thisArg, args: unknown[]) {
      if (isTaggedTemplate(args[0])) assertSafeBindings(args.slice(1));
      return (target as unknown as (...callArgs: unknown[]) => unknown)(
        ...args,
      );
    },
  });
