# SEO Runbook

Billet ships first-class SEO defaults: server-rendered metadata, a canonical
URL on every page, `robots.txt`, an XML sitemap, site-level JSON-LD, an explicit
indexing policy per page, and trailing-slash canonicalisation. Indexing itself
is closed by default and opened with one variable. This runbook covers the two
required config steps, how to extend each piece as you add pages, and how to
verify it in production.

Everything here is server-side — crawlers and AI agents get the full picture in
the initial HTML response, no client JS required.

## 1. Required configuration

### 1a. The canonical site URL (nothing to edit)

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
  Blank counts as unset, so an empty `SITE_URL=` falls back to `APP_URL` instead
  of stopping the boot.

`SITE_NAME` and `SITE_DESCRIPTION` *do* stay as constants in `seo.ts` — those are
product identity, not deployment config. They feed the JSON-LD, the web app
manifest, and the default `<meta name="description">`. Update them to match your
product.

### 1b. Opening the site to search engines (`ALLOW_INDEXING`)

**The site is `noindex` until you say otherwise.** `indexingAllowed()` in
[`src/server/services/seo.ts`](../src/server/services/seo.ts) is true only when
the `ALLOW_INDEXING` environment variable is exactly `true`. Until it is, three
layers keep crawlers out at once:

- `/robots.txt` is a blanket `Disallow: /` with no `Sitemap:` line and no named
  AI-crawler groups (§5),
- every response carries `X-Robots-Tag: noindex, nofollow` (`withSecurityHeaders`
  in [`utils/security-headers.ts`](../src/server/utils/security-headers.ts)) —
  the header, not just the meta tag, because an image, the sitemap itself,
  `llms.txt` and every JSON endpoint is indexable on its own and has nowhere to
  put a `<meta>`,
- every page renders `<meta name="robots" content="noindex, nofollow">` and
  omits the site JSON-LD (§4, §6).

Set `ALLOW_INDEXING=true` on the production host, and only there. A preview
deploy, a staging box or a fork's first Railway URL stays out of the index by
virtue of nobody having configured it, which is the failure mode you want.
Anything other than exactly `true` reads as closed, typos included — the value
is read per request, so a platform restart flips it either way.

**Set it on the production host before or with the deploy that first ships this,
not after.** On a host whose URLs are already in Google, `Disallow: /` blocks the
crawl that would let Google *see* the `noindex` — the same trap §4 describes per
page. An already-indexed site doesn't drop out of search cleanly this way; its
URLs freeze as title-only results. To de-index a live host, leave crawling
allowed, serve the `noindex`, and use a Search Console removal.

## 2. Per-page metadata

Every page renders through `Layout` (or `BaseLayout` for chrome-less pages) in
[`src/server/components/layouts.tsx`](../src/server/components/layouts.tsx). Each
page passes its own metadata as props:

| Prop | What it controls | Notes |
|---|---|---|
| `title` | `<title>` + `og:title` + `twitter:title` | Unique per page; keep under ~60 chars |
| `description` | `<meta name="description">` + OG/Twitter | Unique per page; ~150 chars. Falls back to `SITE_DESCRIPTION` |
| `canonicalPath` | `<link rel="canonical">` + `og:url` | Path only (e.g. `/stack`); resolved against the canonical origin (§1a) |
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

Two things decide whether a page says `noindex`: the site-wide switch (§1b) and
the page's own `noindex` prop. The prop is an opt-*out* layered on a default that
already keeps the page out, so a page that passes it stays `noindex` after
`ALLOW_INDEXING=true` opens the rest of the site up. `blocksIndexing` in
[`layouts.tsx`](../src/server/components/layouts.tsx) is the whole of that rule.

Currently applied to `/admin` (private) and `/login` (thin/private). A page that
is `noindex` — by its own prop or by the site-wide default — also **omits the
site JSON-LD**: you don't want structured data on pages you're telling crawlers
to ignore.

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
serves it. It serves one of two bodies, chosen by `ALLOW_INDEXING` (§1b).

Without `ALLOW_INDEXING=true` — the default, and what a preview or staging host
gets — it is a blanket `Disallow: /` and nothing else. No `Sitemap:` line: a
crawler told to stay out has no business being handed the list of everything
there is. No named AI-crawler groups either, because a named group *replaces*
the wildcard for that agent and would hand each one an exemption from the
blanket rule.

With `ALLOW_INDEXING=true` it:

- allows all user-agents,
- disallows the private surfaces listed in `ROBOTS_DISALLOW` — `/admin`,
  `/account`, `/api/`, `/auth/`, `/team`, `/invites/`,
- repeats the same rules for each crawler in `AI_CRAWLERS` (GPTBot, ClaudeBot,
  PerplexityBot and friends), because in robots.txt a named user-agent group
  fully replaces the wildcard group for that agent,
- declares `Content-Signal: search=yes, ai-input=yes, ai-train=yes`,
- points crawlers at the sitemap.

The `Sitemap:` line is an absolute URL built from the canonical origin (§1a), so
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

After deploying (replace the host with your production domain). Everything below
assumes `ALLOW_INDEXING=true` is set on that host — check that first, because
without it the `robots` and indexing-policy steps are *supposed* to fail:

- **Indexing switch** — `curl -sI https://example.com/` has **no**
  `X-Robots-Tag` header. If it answers `noindex, nofollow`, `ALLOW_INDEXING` is
  unset on the host and nothing else in this list will read as expected.
- **Sitemap** — `curl -sI https://example.com/sitemap.xml` returns `200` with
  `Content-Type: application/xml`; the body lists only canonical public URLs.
- **robots** — `curl -s https://example.com/robots.txt` shows `Allow: /`, the
  disallow rules and the absolute `Sitemap:` line. A bare `Disallow: /` means
  `ALLOW_INDEXING` is unset.
- **Redirect** — `curl -sI https://example.com/stack/` returns `308` with a
  `Location` of the slash-free path.
- **Indexing policy** — view-source on a public page shows no `noindex`; on
  `/admin` and `/login` it shows `<meta name="robots" content="noindex, nofollow">`.
  A `noindex` on *every* page is the site-wide default, not a per-page bug — see
  the indexing-switch step above.
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
