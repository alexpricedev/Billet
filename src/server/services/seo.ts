// Single source of truth for the site's public identity and SEO artefacts
// (sitemap, structured data). Templates and controllers import from here so the
// canonical host, name, and description can't drift across the codebase.

export const SITE_URL = "https://billet.alexprice.dev";
export const SITE_NAME = "Billet";
export const SITE_DESCRIPTION =
  "Full-stack TypeScript starter — designed to be built on by AI coding agents";

// Public, indexable routes included in the sitemap. Private or noindex routes
// (/login, /admin), API endpoints, and auth callbacks are intentionally omitted.
export const SITEMAP_PATHS = ["/", "/stack", "/forms", "/projects"] as const;

const absolute = (path: string): string => new URL(path, SITE_URL).href;

export const buildSitemapXml = (): string => {
  const urls = SITEMAP_PATHS.map(
    (path) => `  <url>\n    <loc>${absolute(path)}</loc>\n  </url>`,
  ).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
};

// Site-level JSON-LD (WebSite + Organization) injected into every public page's
// <head>. Gives search engines and AI agents a machine-readable description of
// the site using the schema.org vocabulary.
export const siteStructuredData = (): string =>
  JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        url: `${SITE_URL}/`,
        name: SITE_NAME,
        description: SITE_DESCRIPTION,
        publisher: { "@id": `${SITE_URL}/#organization` },
      },
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#organization`,
        name: SITE_NAME,
        url: `${SITE_URL}/`,
        logo: absolute("/og-image.png"),
      },
    ],
  });
