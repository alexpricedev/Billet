import type { LinkValue } from "@alexpricedev/billet-cms/fields";
import type { PreviewAccess } from "@alexpricedev/billet-cms/server";
import { log } from "../services/logger";
import { hero } from "./definitions";
import { content, pages } from "./readers";

export interface HeroAction {
  label: string;
  href: string;
  newTab: boolean;
}

export interface HomeHeroContent {
  tag: string;
  heading: string;
  body: string;
  primaryAction: HeroAction;
  secondaryAction: HeroAction | null;
}

/**
 * A button from a link: its words are the link's own `label`. A link with no
 * words, or one to a page that isn't published, is no button at all — and says
 * so in the log, because on screen the button is simply missing.
 */
export const resolveAction = async (
  link: LinkValue,
): Promise<HeroAction | null> => {
  const label = link.label?.trim();
  if (!label) {
    log.warn("cms", "button dropped: its link has no button text");
    return null;
  }
  const href = await pages.resolveLink(link);
  if (!href) {
    log.warn(
      "cms",
      `button "${label}" dropped: page ${link.type === "page" ? link.pageId : ""} is not published`,
    );
    return null;
  }
  return { label, href, newTab: link.newTab === true };
};

/**
 * The CMS-edited home hero, or `null` for the template's hard-coded one.
 *
 * `null` covers everything the CMS can't answer — never filled in, not
 * published, no `cms_` tables yet — and a primary button whose target page has
 * since been deleted, because a hero without its main action is worse than the
 * default one.
 */
export const getHomeHero = async (
  preview: PreviewAccess | null,
): Promise<HomeHeroContent | null> => {
  const slot = await content.getSlot("home.hero", { block: hero, preview });
  if (!slot) return null;

  const primaryAction = await resolveAction(slot.primaryAction);
  if (!primaryAction) return null;

  return {
    tag: slot.tag,
    heading: slot.heading,
    body: slot.body,
    primaryAction,
    secondaryAction: slot.secondaryAction
      ? await resolveAction(slot.secondaryAction)
      : null,
  };
};
