import {
  block,
  image,
  link,
  pageType,
  richText,
  slot,
  text,
} from "@alexpricedev/billet-cms/fields";

/**
 * No render function: both buttons are `link()`s, and a link to a CMS page is
 * resolved against the database, which a synchronous render can't do. The home
 * template renders it — see `cms/home-hero.ts`.
 */
export const hero = block("hero", {
  tag: text({ max: 60, label: "Eyebrow" }),
  heading: text({ max: 80, label: "Heading" }),
  body: text({ max: 400, label: "Intro" }),
  // Each button is one link: the editor's Button text is the link's own
  // `label`, which the CMS requires whenever the link goes somewhere.
  primaryAction: link({ label: "Primary button" }),
  secondaryAction: link({ label: "Secondary button", required: false }),
});

// The marketing page's body blocks. Like the hero they carry no render
// function: images and links resolve against the database, so
// `cms/marketing-page.ts` reads them and `templates/marketing.tsx` renders.
export const prose = block("prose", {
  heading: text({ max: 80, label: "Heading", required: false }),
  body: richText({ label: "Text" }),
});

export const fullImage = block("fullImage", {
  image: image({ label: "Image", minWidth: 1920, aspect: "16:9" }),
  caption: text({ max: 200, label: "Caption", required: false }),
});

export const ctaBanner = block("ctaBanner", {
  heading: text({ max: 80, label: "Heading" }),
  body: text({ max: 240, label: "Text", required: false }),
  action: link({ label: "Button" }),
});

export const homeHero = slot("home.hero", hero, {
  previewPath: "/",
  label: "Home hero",
});

/** One hero, always first, then any mix of the body blocks. */
export const marketing = pageType("marketing", {
  label: "Marketing page",
  help: "A hero at the top, then text, full-width images and call-to-action banners.",
  allowedBlocks: [hero, prose, fullImage, ctaBanner],
  requiredBlocks: [hero],
  limits: { hero: { min: 1, max: 1, position: "top" } },
});

export const blocks = [hero, prose, fullImage, ctaBanner];
export const slots = [homeHero];
export const pageTypes = [marketing];
