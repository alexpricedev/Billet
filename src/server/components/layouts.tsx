import type React from "react";

import { getAssetUrl } from "../services/assets";
import type { User } from "../services/users";
import { Logo } from "./logo";
import { Nav } from "./nav";

const SITE_URL = "https://billet.alexprice.dev";
const SITE_DESCRIPTION =
  "Full-stack TypeScript starter — designed to be built on by AI coding agents";

interface LayoutProps {
  title: string;
  name: string;
  children: React.ReactNode;
  user?: User | null;
  csrfToken?: string;
}

export function Layout({
  title,
  name,
  children,
  user,
  csrfToken,
}: LayoutProps) {
  return (
    <html lang="en" style={{ colorScheme: "dark" }}>
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
        <title>{title}</title>
        <meta name="description" content={SITE_DESCRIPTION} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={SITE_DESCRIPTION} />
        <meta property="og:image" content={`${SITE_URL}/og-image.png`} />
        <meta property="og:url" content={SITE_URL} />
        <meta property="og:type" content="website" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={SITE_DESCRIPTION} />
        <meta name="twitter:image" content={`${SITE_URL}/og-image.png`} />
        <link rel="stylesheet" href={getAssetUrl("/assets/main.css")} />
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
}

export function BaseLayout({ title, children }: BaseLayoutProps) {
  return (
    <html lang="en" style={{ colorScheme: "dark" }}>
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
        <title>{title}</title>
        <link rel="stylesheet" href={getAssetUrl("/assets/main.css")} />
      </head>
      <body>{children}</body>
    </html>
  );
}
