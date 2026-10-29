/**
 * The one tone vocabulary.
 *
 * Badges and banners both key off `data-tone`, so they have to mean the same
 * thing by the same word. They did not: a badge's destructive tone was
 * `danger` and a banner's was `error`, and copying one to the other fell
 * through to the default with nothing to notice it. `danger` won because it is
 * what the rest of the system already says — `--danger`, `--danger-soft`,
 * `.btn-danger`.
 *
 * This type is the fence. A component narrows it to the subset it can draw,
 * so a tone it has no rule for fails `bun run typecheck` rather than rendering
 * untinted.
 */
export type Tone =
  | "success"
  | "info"
  | "warning"
  | "danger"
  | "accent"
  | "neutral";

/**
 * What a banner can be. No `accent` or `neutral`: a banner is an event with an
 * outcome, and "neutral news" is `info`.
 */
export type BannerTone = Extract<
  Tone,
  "success" | "info" | "warning" | "danger"
>;

/**
 * The flash cookie is a wire format, not a palette: it records *what happened*
 * (`success` / `error` / `warning`) and is written by controllers, read once on
 * the next request. Its words are deliberately not renamed to match the tones —
 * a cookie written before a deploy and read after would carry a value the CSS
 * no longer has, and would render untinted. So the translation happens here,
 * at the one point where a message becomes something drawn.
 */
export const toneForMessage = (
  type: "success" | "error" | "warning",
): BannerTone => (type === "error" ? "danger" : type);
