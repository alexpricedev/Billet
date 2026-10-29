import { describe, expect, test } from "bun:test";
import { renderToString } from "preact-render-to-string";
import { Badge } from "./badge";
import { Flash } from "./flash";
import { type Tone, toneForMessage } from "./tone";

// Every tone the vocabulary allows, and the CSS file that has to draw it.
const TONES: Tone[] = [
  "success",
  "info",
  "warning",
  "danger",
  "accent",
  "neutral",
];

const toneAttributes = (css: string): Set<string> =>
  new Set(
    [...css.matchAll(/\[data-tone="([a-z]+)"\]/g)].map((match) => match[1]),
  );

describe("tone vocabulary", () => {
  // The defect this guards: badges and banners both key off `data-tone`, and
  // used two different words for the destructive one. A tone a component has
  // no rule for renders untinted, with nothing to notice it.
  test("every data-tone in the stylesheets is a tone the vocabulary allows", async () => {
    const files = ["flash.css", "page.css"];
    for (const file of files) {
      const css = await Bun.file(
        new URL(`../../client/components/${file}`, import.meta.url),
      ).text();
      for (const tone of toneAttributes(css)) {
        expect(TONES as string[], `${file} draws an unknown tone`).toContain(
          tone,
        );
      }
    }
  });

  test("the banner's destructive tone is the same word as the badge's", async () => {
    const banner = await Bun.file(
      new URL("../../client/components/flash.css", import.meta.url),
    ).text();
    const badge = await Bun.file(
      new URL("../../client/components/page.css", import.meta.url),
    ).text();

    expect(toneAttributes(banner)).toContain("danger");
    expect(toneAttributes(badge)).toContain("danger");
    expect(toneAttributes(banner)).not.toContain("error");
  });

  test("a banner renders the tone it was given", () => {
    for (const tone of ["success", "info", "warning", "danger"] as const) {
      expect(renderToString(<Flash tone={tone} title="Hi." />)).toContain(
        `data-tone="${tone}"`,
      );
    }
  });

  // A role badge draws a shared tone rather than a colour rule of its own, so
  // it cannot drift away from the palette.
  test("a role badge carries a tone from the same vocabulary", () => {
    for (const variant of ["admin", "user", "owner", "member"] as const) {
      const html = renderToString(<Badge variant={variant}>{variant}</Badge>);
      const tone = /data-tone="([a-z]+)"/.exec(html)?.[1] ?? "";

      expect(tone, `${variant} has no tone`).not.toBe("");
      expect(TONES as string[]).toContain(tone);
      // The class stays as a markup hook; the tone is what styles it.
      expect(html).toContain(`badge-${variant}`);
    }
  });

  // The flash cookie keeps its own words on purpose — see tone.ts.
  test("translates the flash cookie's words into tones", () => {
    expect(toneForMessage("error")).toBe("danger");
    expect(toneForMessage("success")).toBe("success");
    expect(toneForMessage("warning")).toBe("warning");
  });
});
