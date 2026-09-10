import { describe, expect, mock, test } from "bun:test";
import { testDatabase } from "../test-utils/database";
import { expectQueryToReject } from "../test-utils/helpers";

const testDb = testDatabase();
mock.module("../services/database", () => ({ db: testDb }));

// Imports below the mock on purpose: `sql.ts` captures `db` at import time, so
// the mock has to be registered first. See CLAUDE.md, "Service tests mock the
// DB module before importing the service".
const { inList, jsonbValue, textArrayLiteral } = await import("./sql");

describe("the pool guard", () => {
  test("rejects an array bound as a parameter", async () => {
    // Unguarded this returns the string "a,b" and no error at any layer.
    await expectQueryToReject(
      () => testDb`SELECT ${["a", "b"]}::text AS v`,
      /Unsafe SQL parameter \$1: an array binds as a comma-joined string/,
    );
  });

  test("rejects a plain object bound as a parameter", async () => {
    await expectQueryToReject(
      () => testDb`SELECT ${{ a: 1 }}::text AS v`,
      /\[object Object\]/,
    );
  });

  test("names the parameter's position", async () => {
    await expectQueryToReject(
      () => testDb`SELECT ${"fine"}::text, ${{ a: 1 }}::text`,
      /parameter \$2/,
    );
  });

  test("passes the values Bun encodes correctly", async () => {
    const when = new Date("2020-01-01T00:00:00Z");
    const [row] = await testDb`
      SELECT ${"text"}::text AS s, ${7}::int AS n, ${true}::boolean AS b,
             ${null}::text AS nothing, ${when}::timestamptz AS t
    `;
    expect(row).toEqual({
      s: "text",
      n: 7,
      b: true,
      nothing: null,
      t: when,
    });
  });

  test("leaves the fragment call form alone", async () => {
    // `db(array)` builds a parameter list rather than binding a value, so it
    // must reach Bun untouched — this is what `inList` is built on.
    const rows = await testDb`
      SELECT x FROM (VALUES ('a'), ('b'), ('c')) v(x) WHERE x IN ${testDb(["a", "c"])}
    `;
    expect(rows.map((row: { x: string }) => row.x).sort()).toEqual(["a", "c"]);
  });
});

describe("jsonbValue", () => {
  test("round-trips an object through a jsonb column", async () => {
    const [row] =
      await testDb`SELECT ${jsonbValue({ a: 1, nested: { b: [2, 3] } })}::jsonb AS v`;
    expect(row.v).toEqual({ a: 1, nested: { b: [2, 3] } });
  });

  test("a stringified object stores a jsonb scalar instead", async () => {
    // The hazard the signature exists to prevent: legal SQL, no error, and the
    // column holds one long string that matches no query.
    const [row] =
      await testDb`SELECT jsonb_typeof(${JSON.stringify({ a: 1 })}::jsonb) AS kind`;
    expect(row.kind).toBe("string");

    const [correct] =
      await testDb`SELECT jsonb_typeof(${jsonbValue({ a: 1 })}::jsonb) AS kind`;
    expect(correct.kind).toBe("object");
  });

  test("returns the value it was given", () => {
    const value = { a: 1 };
    expect(jsonbValue(value)).toBe(value);
  });

  test("accepts null", () => {
    expect(jsonbValue(null)).toBeNull();
  });

  test("declaring one object does not clear another", async () => {
    jsonbValue({ declared: true });
    await expectQueryToReject(
      () => testDb`SELECT ${{ declared: false }}::jsonb`,
    );
  });
});

describe("inList", () => {
  test("matches a set", async () => {
    const rows = await testDb`
      SELECT x FROM (VALUES ('a'), ('b'), ('c')) v(x) WHERE x IN ${inList(["b", "c"])}
    `;
    expect(rows.map((row: { x: string }) => row.x).sort()).toEqual(["b", "c"]);
  });

  test("throws on an empty set rather than rendering IN ()", () => {
    expect(() => inList([])).toThrow(/Short-circuit the query instead/);
  });
});

describe("textArrayLiteral", () => {
  test("round-trips through a text[] cast", async () => {
    const [row] =
      await testDb`SELECT ${textArrayLiteral(["a", "b"])}::text[] AS v`;
    expect(row.v).toEqual(["a", "b"]);
  });

  test("survives the characters array syntax uses", async () => {
    const values = ['a"b', "c,d", "{e}", "back\\slash", ""];
    const [row] = await testDb`SELECT ${textArrayLiteral(values)}::text[] AS v`;
    expect(row.v).toEqual(values);
  });

  test("renders an empty array", async () => {
    const [row] = await testDb`SELECT ${textArrayLiteral([])}::text[] AS v`;
    expect(row.v).toEqual([]);
  });
});
