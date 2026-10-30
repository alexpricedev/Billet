import {
  type BlockContent,
  type BlockDefinition,
  type BlockFields,
  blockContentReadSchema,
} from "@alexpricedev/billet-cms/fields";
import {
  type CmsPage,
  type CmsPageBlock,
  createCmsPageRoute,
  pageSeo,
  renderCmsImage,
  renderRichText,
} from "@alexpricedev/billet-cms/server";
import type { BunRequest } from "bun";
import { getSessionContext } from "../middleware/auth";
import { createCsrfToken } from "../services/csrf";
import { db } from "../services/database";
import { log } from "../services/logger";
import { Marketing } from "../templates/marketing";
import { render404 } from "../utils/errors";
import { render } from "../utils/response";
import { ctaBanner, fullImage, hero, marketing, prose } from "./definitions";
import { type HeroAction, resolveAction } from "./home-hero";
import { media, pages } from "./readers";

export interface MarketingHero {
  tag: string;
  heading: string;
  body: string;
  // Primary first. A button whose target page has gone drops out rather than
  // taking the hero with it: on its own page the hero is the headline.
  actions: HeroAction[];
}

export type MarketingSection =
  | { type: "prose"; heading: string | null; html: string }
  | { type: "fullImage"; html: string; caption: string | null }
  | {
      type: "ctaBanner";
      heading: string;
      body: string | null;
      // A button to a page that isn't published yet drops out; the banner's
      // words still show, so an editor previewing a draft sees the block.
      action: HeroAction | null;
    };

export interface MarketingPageContent {
  hero: MarketingHero | null;
  sections: MarketingSection[];
}

/**
 * One stored block against its own definition. The reader has already checked
 * it against the published JSON Schema; this is the site's own Zod check, which
 * is what types the fields.
 */
const parse = <F extends BlockFields>(
  definition: BlockDefinition<F>,
  block: CmsPageBlock,
): BlockContent<F> | null => {
  const { type: _type, ...fields } = block;
  const result = blockContentReadSchema(definition).safeParse(fields);
  if (!result.success) {
    log.warn("cms", `marketing block "${block.type}" skipped: invalid content`);
    return null;
  }
  return result.data as BlockContent<F>;
};

const resolveSection = async (
  block: CmsPageBlock,
): Promise<MarketingSection | null> => {
  switch (block.type) {
    case prose.name: {
      const content = parse(prose, block);
      if (!content) return null;
      const html = renderRichText(content.body);
      return html
        ? { type: "prose", heading: content.heading?.trim() || null, html }
        : null;
    }
    case fullImage.name: {
      const content = parse(fullImage, block);
      if (!content) return null;
      const item = await media.getMedia(content.image.mediaId);
      const html = item
        ? renderCmsImage(item, { alt: content.image.alt, sizes: "100vw" })
        : "";
      return html
        ? {
            type: "fullImage",
            html,
            caption: content.caption?.trim() || null,
          }
        : null;
    }
    case ctaBanner.name: {
      const content = parse(ctaBanner, block);
      if (!content) return null;
      return {
        type: "ctaBanner",
        heading: content.heading,
        body: content.body?.trim() || null,
        action: await resolveAction(content.action),
      };
    }
    default:
      return null;
  }
};

/**
 * A marketing page's blocks, resolved for the template. Anything that can't be
 * shown — invalid content, a deleted image, a button to a deleted page — is
 * left out, so one stale block never takes the page down. A button that won't
 * resolve drops on its own; the block around it stays.
 */
export const resolveMarketingPage = async (
  blocks: CmsPageBlock[],
): Promise<MarketingPageContent> => {
  const [first, ...rest] = blocks;
  const heroContent = first?.type === hero.name ? parse(hero, first) : null;

  let resolvedHero: MarketingHero | null = null;
  if (heroContent) {
    const actions = await Promise.all([
      resolveAction(heroContent.primaryAction),
      heroContent.secondaryAction
        ? resolveAction(heroContent.secondaryAction)
        : null,
    ]);
    resolvedHero = {
      tag: heroContent.tag,
      heading: heroContent.heading,
      body: heroContent.body,
      actions: actions.filter((action) => action !== null),
    };
  }

  const body = first?.type === hero.name ? rest : blocks;
  const sections = await Promise.all(body.map(resolveSection));

  return {
    hero: resolvedHero,
    sections: sections.filter((section) => section !== null),
  };
};

const renderPage = async (page: CmsPage, req: Request): Promise<Response> => {
  // Only one page type is declared today. A page of a type this deploy no
  // longer knows has no template, and a 404 is more honest than a blank page.
  if (page.pageType !== marketing.name) return render404();

  const { user, sessionId } = await getSessionContext(req as BunRequest);
  const csrfToken = sessionId
    ? await createCsrfToken(sessionId, "POST", "/auth/logout")
    : undefined;

  return render(
    <Marketing
      seo={await pageSeo(page, { media })}
      content={await resolveMarketingPage(page.blocks)}
      user={user ?? null}
      csrfToken={csrfToken}
    />,
  );
};

/**
 * The catch-all for CMS pages, mounted in `handleFallback` just before the 404:
 * a CMS redirect, then a previewed or published page, else `null`. App routes
 * always win, because the fallback only runs for a path no route claimed.
 */
export const cmsPageRoute = createCmsPageRoute({
  sql: db,
  reader: pages,
  render: (page, { req }) => renderPage(page, req),
});
