import type { ComponentChildren } from "preact";

import { getAssetUrl } from "../services/assets";
import {
  SITE_DESCRIPTION,
  SITE_NAME,
  siteStructuredData,
  siteUrl,
} from "../services/seo";
import type { User } from "../services/users";
import { Logo } from "./logo";
import { Nav } from "./nav";
import { VerifyBanner } from "./verify-banner";

// The site is dark-only (see `colorScheme: "dark"` on <html>), so theme-color
// matches --color-bg from style.css rather than shipping light/dark variants.
const THEME_COLOR = "#0a0a0b";

const canonicalUrl = (path?: string): string =>
  path ? new URL(path, siteUrl()).href : siteUrl();

interface HeadMetaProps {
  title: string;
  description: string;
  canonicalPath?: string;
  noindex?: boolean;
}

// Shared <head> essentials for both Layout and BaseLayout, so the two can't
// drift out of sync (e.g. one missing the description or canonical tag).
function HeadMeta({
  title,
  description,
  canonicalPath,
  noindex,
}: HeadMetaProps) {
  return (
    <>
      <meta charSet="utf-8" />
      <meta
        name="viewport"
        content="width=device-width, initial-scale=1, viewport-fit=cover"
      />
      <title>{title}</title>
      <meta name="description" content={description} />
      {noindex && <meta name="robots" content="noindex, nofollow" />}
      <meta name="color-scheme" content="dark" />
      <meta name="theme-color" content={THEME_COLOR} />
      <link rel="canonical" href={canonicalUrl(canonicalPath)} />
      <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
      <link
        rel="apple-touch-icon"
        sizes="180x180"
        href="/apple-touch-icon.png"
      />
      <link
        rel="icon"
        type="image/png"
        sizes="32x32"
        href="/favicon-32x32.png"
      />
      <link
        rel="icon"
        type="image/png"
        sizes="16x16"
        href="/favicon-16x16.png"
      />
      <link rel="manifest" href="/site.webmanifest" />
      <link rel="stylesheet" href={getAssetUrl("/assets/main.css")} />
    </>
  );
}

interface LayoutProps {
  title: string;
  name: string;
  children: ComponentChildren;
  user?: User | null;
  csrfToken?: string;
  description?: string;
  canonicalPath?: string;
  noindex?: boolean;
}

export function Layout({
  title,
  name,
  children,
  user,
  csrfToken,
  description = SITE_DESCRIPTION,
  canonicalPath,
  noindex,
}: LayoutProps) {
  return (
    <html lang="en" style={{ colorScheme: "dark" }}>
      <head>
        <HeadMeta
          title={title}
          description={description}
          canonicalPath={canonicalPath}
          noindex={noindex}
        />
        {/* Preact (via the importmap below) loads from esm.sh and Lottie from
            unpkg. Preconnect opens the TLS connection while the HTML parses so
            the first cross-origin fetch doesn't pay the handshake; dns-prefetch
            is the cheaper fallback for browsers that ignore preconnect. */}
        <link rel="preconnect" href="https://esm.sh" crossOrigin="anonymous" />
        <link
          rel="preconnect"
          href="https://unpkg.com"
          crossOrigin="anonymous"
        />
        <link rel="dns-prefetch" href="https://esm.sh" />
        <link rel="dns-prefetch" href="https://unpkg.com" />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:image" content={`${siteUrl()}/og-image.png`} />
        <meta property="og:url" content={canonicalUrl(canonicalPath)} />
        <meta property="og:type" content="website" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />
        <meta name="twitter:image" content={`${siteUrl()}/og-image.png`} />
        {!noindex && (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: siteStructuredData() }}
          />
        )}
        <script
          type="importmap"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              imports: {
                preact: "https://esm.sh/preact@10.29.8",
                "preact/hooks": "https://esm.sh/preact@10.29.8/hooks",
                "preact/jsx-dev-runtime":
                  "https://esm.sh/preact@10.29.8/jsx-dev-runtime",
                "preact/jsx-runtime":
                  "https://esm.sh/preact@10.29.8/jsx-runtime",
              },
            }),
          }}
        />
      </head>
      {/* data-banner drives the body offset for the fixed banner. Set from the
          same condition the component renders on, so the padding can't outlive
          the bar it makes room for. */}
      <body
        data-page={name}
        data-component="layout"
        data-banner={
          user && !user.email_verified_at ? "verify-email" : undefined
        }
      >
        <VerifyBanner user={user} />
        <header>
          <a href="/" className="logo">
            <Logo />
            <span>Billet</span>
          </a>
          <Nav page={name} user={user} csrfToken={csrfToken} />
        </header>
        <main>{children}</main>
        <SiteFooter />
        <script
          async
          src="https://unpkg.com/lottie-web@5.13.0/build/player/lottie_light.min.js"
          integrity="sha384-Gr3FGWSrOz4fzm9bvrWwhuQH87JMUCLlOTaHhpddbnlHHWCZPxMeQ3KUPsomzIii"
          crossOrigin="anonymous"
        />
        <script type="module" src={getAssetUrl("/assets/main.js")} />
      </body>
    </html>
  );
}

// Shared site footer for the full Layout and the ErrorLayout, so the links back to
// the original Billet repo live in one place for a fork to replace.
function SiteFooter() {
  return (
    <footer>
      <a href="https://github.com/alexpricedev/Billet">GitHub</a>
      <span>
        Built by <a href="https://alexprice.dev">alexprice.dev</a>
      </span>
    </footer>
  );
}

interface ErrorLayoutProps {
  title: string;
  children: ComponentChildren;
  nav?: boolean;
}

// Layout for error and maintenance pages (404, 500, 503). Deliberately ships NO
// client JavaScript — no importmap, Lottie, or main bundle — so the page renders
// instantly and stays legible even when the app is degraded or offline, the
// spec's resilience baseline for error and 503 responses. Reuses the same
// header/footer chrome as `Layout` for continuity, and is always noindex so
// crawlers never treat an error body as real content.
export function ErrorLayout({ title, children, nav = true }: ErrorLayoutProps) {
  return (
    <html lang="en" style={{ colorScheme: "dark" }}>
      <head>
        <HeadMeta title={title} description={SITE_DESCRIPTION} noindex />
      </head>
      <body data-page="error" data-component="layout">
        <header>
          <a href="/" className="logo">
            <Logo />
            <span>{SITE_NAME}</span>
          </a>
          {nav && <Nav page="" user={null} />}
        </header>
        <main>{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}

interface BaseLayoutProps {
  title: string;
  children: ComponentChildren;
  description?: string;
  canonicalPath?: string;
  noindex?: boolean;
}

export function BaseLayout({
  title,
  children,
  description = SITE_DESCRIPTION,
  canonicalPath,
  noindex,
}: BaseLayoutProps) {
  return (
    <html lang="en" style={{ colorScheme: "dark" }}>
      <head>
        <HeadMeta
          title={title}
          description={description}
          canonicalPath={canonicalPath}
          noindex={noindex}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
