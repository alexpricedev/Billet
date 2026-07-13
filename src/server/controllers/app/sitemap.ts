import { buildSitemapXml } from "../../services/seo";

export const sitemap = {
  index(): Response {
    return new Response(buildSitemapXml(), {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  },
};
