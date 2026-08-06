import { describe, expect, test } from "bun:test";
import { Glob } from "bun";

// Preact passes attribute names through verbatim, so a React-style camelCase SVG
// attribute reaches the browser unrecognised and the property silently falls back
// to its default — no error, no failing render, just a wrong-looking icon. This
// guard fails the suite instead, naming the file and the replacement.
//
// Only attributes hyphenated in the SVG spec belong here. Genuinely camelCase SVG
// attributes (viewBox, preserveAspectRatio, gradientUnits, stdDeviation, ...) are
// correct as written and must not be flagged.
const HYPHENATED_SVG_ATTRIBUTES = [
  "alignment-baseline",
  "baseline-shift",
  "clip-path",
  "clip-rule",
  "color-interpolation-filters",
  "dominant-baseline",
  "fill-opacity",
  "fill-rule",
  "flood-color",
  "flood-opacity",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "image-rendering",
  "letter-spacing",
  "marker-end",
  "marker-mid",
  "marker-start",
  "mask-type",
  "paint-order",
  "pointer-events",
  "shape-rendering",
  "stop-color",
  "stop-opacity",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-opacity",
  "stroke-width",
  "text-anchor",
  "text-rendering",
  "vector-effect",
  "word-spacing",
  "writing-mode",
];

const toCamelCase = (attribute: string) =>
  attribute.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());

type Offence = { file: string; line: number; found: string; expected: string };

// Matches the camelCase name only where it is used as a JSX attribute — the
// trailing `=` keeps style objects (`{ strokeWidth: 2 }`) and prose out of it.
const findOffences = (source: string, file: string): Offence[] => {
  const offences: Offence[] = [];

  for (const attribute of HYPHENATED_SVG_ATTRIBUTES) {
    const camel = toCamelCase(attribute);
    const pattern = new RegExp(`(?<![\\w-])${camel}\\s*=`, "g");

    for (const line of source.split("\n").entries()) {
      const [index, text] = line;
      if (pattern.test(text)) {
        offences.push({
          file,
          line: index + 1,
          found: camel,
          expected: attribute,
        });
      }
      pattern.lastIndex = 0;
    }
  }

  return offences;
};

const SELF = "src/server/components/svg-attributes.test.ts";

describe("SVG attribute casing", () => {
  test("detects a camelCase attribute", () => {
    const offences = findOffences('<svg strokeWidth="2" />', "example.tsx");

    expect(offences).toEqual([
      {
        file: "example.tsx",
        line: 1,
        found: "strokeWidth",
        expected: "stroke-width",
      },
    ]);
  });

  test("leaves kebab-case, camelCase SVG attributes, and style objects alone", () => {
    const source = [
      '<svg stroke-width="2" viewBox="0 0 24 24" preserveAspectRatio="none" />',
      "const style = { strokeWidth: 2 };",
    ].join("\n");

    expect(findOffences(source, "example.tsx")).toEqual([]);
  });

  test("no source file uses a React-style camelCase SVG attribute", async () => {
    const offences: Offence[] = [];

    for await (const relative of new Glob("**/*.{ts,tsx}").scan({
      cwd: "src",
    })) {
      const file = `src/${relative}`;
      if (file === SELF) continue;
      offences.push(...findOffences(await Bun.file(file).text(), file));
    }

    const report = offences
      .map(
        ({ file, line, found, expected }) =>
          `${file}:${line} — ${found} should be ${expected}`,
      )
      .join("\n");

    expect(report).toBe("");
  });
});
