# SEO Runbook

Billet ships first-class SEO defaults: server-rendered metadata, a canonical
URL on every page, `robots.txt`, an XML sitemap, site-level JSON-LD, an explicit
indexing policy per page, and trailing-slash canonicalisation. This runbook
covers the one required config step, how to extend each piece as you add pages,
and how to verify it in production.

Everything here is server-side — crawlers and AI agents get the full picture in
the initial HTML response, no client JS required.

## 1. Set the canonical site URL (required)

All absolute URLs — canonicals, Open Graph tags, the sitemap, and JSON-LD — are
built from a single constant. Set it to your production origin **before you
deploy**, or search engines will index and link the placeholder domain.

- Edit `SITE_URL` in [`src/server/services/seo.ts`](../src/server/services/seo.ts).
- Use the scheme + host with **no trailing slash**: `https://example.com`.
- Keep it aligned with `APP_URL` (the env var magic-link emails use). A mismatch
  between the link domain and the canonical domain looks like cloaking to Google.

`SITE_NAME` and `SITE_DESCRIPTION` live in the same file and feed the JSON-LD and
the default `<meta name="description">`. Update them to match your product.

## 2. Per-page metadata

Every page renders through `Layout` (or `BaseLayout` for chrome-less pages) in
[`src/server/components/layouts.tsx`](../src/server/components/layouts.tsx). Each
page passes its own metadata as props:

| Prop | What it controls | Notes |
|---|---|---|
| `title` | `<title>` + `og:title` + `twitter:title` | Unique per page; keep under ~60 chars |
| `description` | `<meta name="description">` + OG/Twitter | Unique per page; ~150 chars. Falls back to `SITE_DESCRIPTION` |
| `canonicalPath` | `<link rel="canonical">` + `og:url` | Path only (e.g. `/stack`); resolved against `SITE_URL` |
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

Also add the path to `Disallow:` in [`public/robots.txt`](../public/robots.txt)
if you want to save crawl budget — but note `Disallow` only blocks crawling, it
does **not** guarantee de-indexing. `noindex` is what removes a page from the
index; a page must be crawlable for the `noindex` to be seen. Don't `Disallow` a
path you also `noindex` unless it's already de-indexed.

## 5. robots.txt

[`public/robots.txt`](../public/robots.txt) is a static file served from the
public dir. It:

- allows all user-agents by default,
- disallows `/admin`, `/api/`, and `/auth/`,
- points crawlers at the sitemap.

The `Sitemap:` line must be an **absolute URL** — update it to your production
domain to match `SITE_URL` (this file is static, so it isn't templated).

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
