import type React from "react";

import { getAssetUrl } from "../services/assets";
import type { User } from "../services/users";
import { Logo } from "./logo";
import { Nav } from "./nav";

const SITE_URL = "https://billet.alexprice.dev";
const SITE_DESCRIPTION =
  "Full-stack TypeScript starter — designed to be built on by AI coding agents";

// The site is dark-only (see `colorScheme: "dark"` on <html>), so theme-color
// matches --color-bg from style.css rather than shipping light/dark variants.
const THEME_COLOR = "#0a0a0b";

const canonicalUrl = (path?: string): string =>
  path ? new URL(path, SITE_URL).href : SITE_URL;

interface HeadMetaProps {
  title: string;
  description: string;
  canonicalPath?: string;
}

// Shared <head> essentials for both Layout and BaseLayout, so the two can't
// drift out of sync (e.g. one missing the description or canonical tag).
function HeadMeta({ title, description, canonicalPath }: HeadMetaProps) {
  return (
    <>
      <meta charSet="utf-8" />
      <meta
        name="viewport"
        content="width=device-width, initial-scale=1, viewport-fit=cover"
      />
      <title>{title}</title>
      <meta name="description" content={description} />
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
  children: React.ReactNode;
  user?: User | null;
  csrfToken?: string;
  description?: string;
  canonicalPath?: string;
}

export function Layout({
  title,
  name,
  children,
  user,
  csrfToken,
  description = SITE_DESCRIPTION,
  canonicalPath,
}: LayoutProps) {
  return (
    <html lang="en" style={{ colorScheme: "dark" }}>
      <head>
        <HeadMeta
          title={title}
          description={description}
          canonicalPath={canonicalPath}
        />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:image" content={`${SITE_URL}/og-image.png`} />
        <meta property="og:url" content={canonicalUrl(canonicalPath)} />
        <meta property="og:type" content="website" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />
        <meta name="twitter:image" content={`${SITE_URL}/og-image.png`} />
        <script
          type="importmap"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              imports: {
                preact: "https://esm.sh/preact@10.28.4",
                "preact/hooks": "https://esm.sh/preact@10.28.4/hooks",
                "preact/jsx-dev-runtime":
                  "https://esm.sh/preact@10.28.4/jsx-dev-runtime",
                "preact/jsx-runtime":
                  "https://esm.sh/preact@10.28.4/jsx-runtime",
              },
            }),
          }}
        />
      </head>
      <body data-page={name} data-component="layout">
        <header>
          <a href="/" className="logo">
            <Logo />
            <span>Billet</span>
          </a>
          <Nav page={name} user={user} csrfToken={csrfToken} />
        </header>
        <main>{children}</main>
        <footer>
          <a href="https://github.com/alexpricedev/Billet">GitHub</a>
          <span>
            Built by <a href="https://alexprice.dev">alexprice.dev</a>
          </span>
        </footer>
        <script
          async
          src="https://unpkg.com/lottie-web@5/build/player/lottie_light.min.js"
        />
        <script type="module" src={getAssetUrl("/assets/main.js")} />
      </body>
    </html>
  );
}

interface BaseLayoutProps {
  title: string;
  children: React.ReactNode;
  description?: string;
  canonicalPath?: string;
}

export function BaseLayout({
  title,
  children,
  description = SITE_DESCRIPTION,
  canonicalPath,
}: BaseLayoutProps) {
  return (
    <html lang="en" style={{ colorScheme: "dark" }}>
      <head>
        <HeadMeta
          title={title}
          description={description}
          canonicalPath={canonicalPath}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
