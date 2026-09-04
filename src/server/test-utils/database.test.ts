import { describe, expect, test } from "bun:test";
import { Glob } from "bun";

// A comment in `database.ts` explains why the pool is capped at 3; it will not
// stop the next test file from writing `new SQL(process.env.DATABASE_URL)` and
// quietly reintroducing a pool of ten. This does. See `database.ts` for the
// arithmetic.
describe("test database helper", () => {
  test("no test file constructs its own SQL pool", async () => {
    const files = [
      ...new Glob("src/**/*.test.ts").scanSync("."),
      ...new Glob("src/**/*.test.tsx").scanSync("."),
    ].filter((file) => !file.endsWith("test-utils/database.test.ts"));

    // A broken walk would otherwise pass with nothing to check.
    expect(files.length).toBeGreaterThan(20);

    const offenders: string[] = [];
    for (const file of files) {
      const source = await Bun.file(file).text();
      if (withoutComments(source).includes("new SQL(")) offenders.push(file);
    }

    expect(offenders).toEqual([]);
  });
});

/**
 * Strip line and block comments, so a comment naming the banned call doesn't
 * trip the check. Crude — it doesn't know about strings — but a test file with
 * `new SQL(` inside a string literal is the same mistake in a thinner disguise.
 */
const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
