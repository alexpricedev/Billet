import { describe, expect, test } from "bun:test";
import { Glob } from "bun";

// The Bun.SQL mistakes a running query can't catch, as a test rather than a
// paragraph. `services/database.ts` guards every bound parameter, but three of
// the four hazards are invisible to it: two are legal SQL the driver builds
// wrongly, and one is a test that hangs instead of failing. Those only fail
// where they are written, so this is where they fail.
//
// `.claude/rules/database.md` has each hazard and its replacement. Add an
// exemption only with the reason written next to it.

const SERVER = "src/server";

// Every rule below quotes the pattern it bans in its own `name` and `why`, so
// this file is the one that must not check itself. Comment stripping isn't
// enough — the strings are code.
const SELF = "src/server/database/driver-safety.test.ts";

const sources = (): string[] =>
  Array.from(new Glob("**/*.{ts,tsx}").scanSync(SERVER))
    .map((file) => `${SERVER}/${file}`)
    .filter((file) => file !== SELF)
    .sort();

/**
 * Strip line and block comments, so a comment naming a banned call doesn't trip
 * the check — every rule below is *about* these patterns, so the files
 * explaining them would otherwise be the first offenders. Crude, in the same
 * way `test-utils/database.test.ts` is: it doesn't know about strings, and a
 * banned pattern hidden in a string literal is the same mistake in a thinner
 * disguise.
 */
const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

type Rule = {
  name: string;
  /** Matched against the file with comments stripped. */
  match: (source: string) => boolean;
  why: string;
  allowed?: Set<string>;
};

/**
 * The bodies of every `db` tagged template in a file.
 *
 * Non-greedy to the next backtick, which stops at a nested template — so a
 * query interpolating one reads as two. That costs a false negative on the
 * remainder, never a false positive, and the queries here don't nest.
 */
const queryBodies = (source: string): string[] =>
  Array.from(source.matchAll(/\b(?:db|sql|testDb)`([\s\S]*?)`/g)).map(
    (match) => match[1],
  );

const FORBIDDEN: Rule[] = [
  {
    name: "an array bound into ANY()",
    match: (source) => /=\s*ANY\(\s*\$\{/i.test(source),
    why: "a JS array binds as one comma-joined value, and Postgres answers `insufficient data left in message` — an error naming neither the parameter nor the query. Interpolate `inList(values)` instead",
  },
  {
    name: "sql.array()",
    match: (source) => /\b(?:db|sql)\.array\(/.test(source),
    why: "it double-quotes every element, so ['A'] arrives as \"A\" with the quotes inside the value. For a text[] column use `textArrayLiteral(values)`",
  },
  {
    name: "expect() on a tagged template",
    match: (source) => /expect\(\s*(?:db|sql|testDb)\s*`/.test(source),
    why: "a Bun.SQL tagged template is a lazy thenable, so .rejects never settles and the file times out with no failing assertion to point at. Use `expectQueryToReject` from test-utils/helpers",
  },
  {
    name: "an unguarded pool",
    match: (source) => /new SQL\(/.test(source),
    why: "a pool built outside these files skips the parameter guard. Use `db` from services/database, or `testDatabase()` in a test",
    // The two pools the codebase has, plus the runners that create and migrate
    // databases before a guarded pool could exist.
    allowed: new Set([
      "src/server/services/database.ts",
      "src/server/test-utils/database.ts",
      "src/server/test-utils/bootstrap.ts",
      "src/server/test-utils/run-tests.ts",
      // The test that bans the same call in test files; it names it in a string.
      "src/server/test-utils/database.test.ts",
    ]),
  },
  {
    name: "JSON.stringify inside a query",
    match: (source) =>
      queryBodies(source).some((body) => body.includes("JSON.stringify")),
    why: "Bun encodes a bound object into jsonb itself, so a stringified one stores a jsonb *string* — one long scalar that reads back as text and matches no query, with no error at any layer. Wrap the object in `jsonbValue(obj)` instead",
    // Demonstrates the hazard against a live connection, which is the only way
    // to show that the wrong form is legal SQL rather than an error.
    allowed: new Set(["src/server/utils/sql.test.ts"]),
  },
];

describe("Bun.SQL driver safety", () => {
  const files = sources();

  // A broken walk would otherwise pass with nothing to check.
  test("there are server files to check", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  for (const rule of FORBIDDEN) {
    test(`no ${rule.name}`, async () => {
      const offenders: string[] = [];
      for (const file of files) {
        if (rule.allowed?.has(file)) continue;
        const source = withoutComments(await Bun.file(file).text());
        if (rule.match(source)) offenders.push(file);
      }

      expect(offenders, rule.why).toEqual([]);
    });
  }

  // The extraction is the load-bearing part of that last rule, and a regex that
  // silently matched nothing would make it pass forever. The fixture leaves the
  // interpolation braces off the call: the rule looks for `JSON.stringify`
  // anywhere in the body, so how the value gets there doesn't change the match.
  test("the query extraction finds queries", () => {
    expect(
      queryBodies(
        "const x = 1;\nawait db`INSERT INTO t (v) VALUES (JSON.stringify(o))`;",
      ),
    ).toEqual(["INSERT INTO t (v) VALUES (JSON.stringify(o))"]);
    expect(queryBodies("const x = 1;")).toEqual([]);
  });
});
