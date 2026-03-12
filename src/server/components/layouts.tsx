import type React from "react";

import type { User } from "../services/users";
import { Logo } from "./logo";
import { Nav } from "./nav";

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
        <link rel="stylesheet" href="/assets/main.css" />
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
        <script type="module" src="/assets/main.js" />
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
        <link rel="stylesheet" href="/assets/main.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
