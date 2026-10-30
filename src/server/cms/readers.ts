import {
  createCmsMedia,
  createCmsPages,
  createContentReader,
} from "@alexpricedev/billet-cms/server";
import { db } from "../services/database";
import { log } from "../services/logger";

// The package logs skipped content to the console by default; route it through
// the site's logger so it lands with everything else.
const onSkip = (message: string) => log.warn("cms", message);

// One of each per process, so the home hero, the page catch-all and every
// link they resolve share a cache and a content-version poll.
export const content = createContentReader({ sql: db, onSkip });
export const pages = createCmsPages({ sql: db, onSkip });
export const media = createCmsMedia({ sql: db, onSkip });
