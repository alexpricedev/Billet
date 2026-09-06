# SEO Runbook

Billet ships first-class SEO defaults: server-rendered metadata, a canonical
URL on every page, `robots.txt`, an XML sitemap, site-level JSON-LD, an explicit
indexing policy per page, and trailing-slash canonicalisation. This runbook
covers the one required config step, how to extend each piece as you add pages,
and how to verify it in production.

Everything here is server-side — crawlers and AI agents get the full picture in
the initial HTML response, no client JS required.

## 1. The canonical site URL (nothing to edit)

All absolute URLs — canonicals, Open Graph tags, the sitemap, `robots.txt`'s
`Sitemap:` line, and JSON-LD — are built from `siteUrl()` in
[`src/server/services/seo.ts`](../src/server/services/seo.ts), which returns
**`APP_URL`'s origin**. `APP_URL` is already required, already validated at boot,
and already the domain your emailed links and CSRF origin check use. So setting
it to your production URL is the whole configuration step; there is no constant
to remember to edit before deploying.

That coupling is the point. A canonical, `og:url`, or sitemap `<loc>` on a
different domain from the one your links use reads to Google as cloaking, and a
drift rule enforced only by a sentence in a runbook is a drift rule that breaks.

**`SITE_URL` (optional, env var)** overrides the origin for the one case where
the two legitimately differ: a marketing site on the apex with the app on a
subdomain (`SITE_URL=https://example.com` while
`APP_URL=https://app.example.com`), or a canonical on `www` when the app isn't.

- Set it in the environment, not in source.
- Scheme + host; a trailing slash or a path is reduced away (`.origin`), so
  `https://example.com/` and `https://example.com` behave identically.
- It must be an absolute `http(s)` URL, and `https` in production. So must
  `APP_URL`. A bad value is fatal at boot rather than a broken canonical on
  every page (`validateEnv()` in [`src/server/utils/env.ts`](../src/server/utils/env.ts)).

`SITE_NAME` and `SITE_DESCRIPTION` *do* stay as constants in `seo.ts` — those are
product identity, not deployment config. They feed the JSON-LD, the web app
manifest, and the default `<meta name="description">`. Update them to match your
product.

## 2. Per-page metadata

Every page renders through `Layout` (or `BaseLayout` for chrome-less pages) in
[`src/server/components/layouts.tsx`](../src/server/components/layouts.tsx). Each
page passes its own metadata as props:

| Prop | What it controls | Notes |
|---|---|---|
| `title` | `<title>` + `og:title` + `twitter:title` | Unique per page; keep under ~60 chars |
| `description` | `<meta name="description">` + OG/Twitter | Unique per page; ~150 chars. Falls back to `SITE_DESCRIPTION` |
| `canonicalPath` | `<link rel="canonical">` + `og:url` | Path only (e.g. `/stack`); resolved against the canonical origin (§1) |
| `noindex` | `<meta name="robots" content="noindex, nofollow">` | See §4 |

Rule: **every page sets `title`, `description`, and `canonicalPath`.** The shared
`HeadMeta` component keeps `Layout` and `BaseLayout` from drifting, so you only
set these once per page.

## 3. Adding a new public page to the sitemap

The sitemap is generated, not hand-maintained. To include a new indexable page:

1. Add its canonical path to `SITEMAP_PATHS` in
   [`src/server/services/seo.ts`](../src/server/services/seo.ts).
2. That's it — `/sitemap.xml` (served by
   [`controllers/app/sitemap.ts`](../src/server/controllers/app/sitemap.ts))
   rebuilds from that list on every request.

Only list **canonical, indexable, public** URLs. Do **not** add `noindex` pages
(`/admin`, `/login`), API endpoints, auth callbacks, or paginated/filtered
variants. A sitemap that lists non-indexable URLs is a quality signal against you.

## 4. Marking a page `noindex`

Private, thin, staging, or duplicate pages must carry an explicit `noindex`. Pass
the `noindex` prop:

```tsx
<Layout title="Admin" canonicalPath="/admin" noindex name="admin" ...>
```

Currently applied to `/admin` (private) and `/login` (thin/private). When
`noindex` is set, the page also **omits the site JSON-LD** — you don't want
structured data on pages you're telling crawlers to ignore.

Also add the path to `ROBOTS_DISALLOW` in
[`src/server/services/seo.ts`](../src/server/services/seo.ts) (§5) if you want to
save crawl budget — but note `Disallow` only blocks crawling, it
does **not** guarantee de-indexing. `noindex` is what removes a page from the
index; a page must be crawlable for the `noindex` to be seen. Don't `Disallow` a
path you also `noindex` unless it's already de-indexed.

## 5. robots.txt

`/robots.txt` is **generated**, not a static file: `buildRobotsTxt()` in
[`src/server/services/seo.ts`](../src/server/services/seo.ts) builds the body and
[`controllers/app/robots-txt.ts`](../src/server/controllers/app/robots-txt.ts)
serves it. It:

- allows all user-agents by default,
- disallows the private surfaces listed in `ROBOTS_DISALLOW` — `/admin`,
  `/account`, `/api/`, `/auth/`, `/team`, `/invites/`,
- repeats the same rules for each crawler in `AI_CRAWLERS` (GPTBot, ClaudeBot,
  PerplexityBot and friends), because in robots.txt a named user-agent group
  fully replaces the wildcard group for that agent,
- declares `Content-Signal: search=yes, ai-input=yes, ai-train=yes`,
- points crawlers at the sitemap.

The `Sitemap:` line is an absolute URL built from the canonical origin (§1), so
it follows your production domain automatically — nothing to edit. To disallow a
new path, add it to `ROBOTS_DISALLOW`.

## 6. Structured data (JSON-LD)

Site-level `WebSite` + `Organization` JSON-LD is injected into every indexable
page's `<head>` by `siteStructuredData()` in
[`src/server/services/seo.ts`](../src/server/services/seo.ts).

To add **page-specific** structured data (e.g. `Article`, `Product`,
`BreadcrumbList`, `FAQPage`), build the object in the page's controller/template
and render it as its own `<script type="application/ld+json">`. Keep it a
`JSON.stringify` of a plain object — never interpolate unescaped user input into
a JSON-LD block. Validate with the Rich Results Test (§8).

## 7. URLs, redirects, and headings

- **Canonicalisation** — `src/server/main.ts` issues a `308` redirect from any
  trailing-slash path to its slash-free form (e.g. `/stack/` → `/stack`),
  preserving the query string. One URL per page, no duplicate crawling.
- **URL structure** — keep new routes lowercase, hyphenated, descriptive, and
  shallow. Treat URLs as a stable public API; avoid renaming a live URL, and
  `301`/`308` it to the new location if you must.
- **Headings** — every page has exactly one `<h1>` and never skips levels
  (`h1` → `h2` → `h3`). Headings are for outline, not visual sizing — style with
  CSS instead of reaching for a bigger tag.

## 8. Verification checklist

After deploying (replace the host with your production domain):

- **Sitemap** — `curl -sI https://example.com/sitemap.xml` returns `200` with
  `Content-Type: application/xml`; the body lists only canonical public URLs.
- **robots** — `curl -s https://example.com/robots.txt` shows the disallow rules
  and the absolute `Sitemap:` line.
- **Redirect** — `curl -sI https://example.com/stack/` returns `308` with a
  `Location` of the slash-free path.
- **Indexing policy** — view-source on a public page shows no `noindex`; on
  `/admin` and `/login` it shows `<meta name="robots" content="noindex, nofollow">`.
- **Structured data** — run a public URL through the
  [Rich Results Test](https://search.google.com/test/rich-results); the
  `WebSite`/`Organization` graph parses with no errors.
- **Search Console** — add and verify the property at
  [Google Search Console](https://search.google.com/search-console), submit
  `sitemap.xml`, and watch Coverage for `noindex`/soft-404/crawl errors.

## 9. Non-goals

Deliberately **not** implemented, and why:

- **Sitemap index files** — only needed above 50,000 URLs or to split by content
  type. Add one (a sitemap of sitemaps) if the site ever grows that large.
- **Image / video sitemap extensions** — useful when media is loaded dynamically
  or hosted on a CDN crawlers can't reach. Not needed for the current static
  assets in `public/`.
- **Breadcrumbs (`BreadcrumbList`)** — the site is flat (one level deep), so
  there's no hierarchy trail to mark up. Add breadcrumbs + JSON-LD if you
  introduce nested sections.
- **IndexNow** — an optional ping protocol for Bing/Yandex/Naver/Seznam (Google
  does not participate). Worth adding if those engines matter and content changes
  frequently; skipped for a low-churn marketing site.
