import type React from "react";

import { Nav } from "./nav";

type LayoutProps = {
  title: string;
  name: string;
  children: React.ReactNode;
};

/**
 * Main application layout with header, navigation, and footer
 * Use for: Authenticated app pages, public marketing pages
 */
export function Layout({ title, name, children }: LayoutProps) {
  return (
    <html lang="en">
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
            <img src="/logo.png" alt="logo" />
          </a>
          <Nav page={name} />
        </header>
        <main>{children}</main>
        <script type="module" src="/assets/main.js" />
      </body>
    </html>
  );
}

type BaseLayoutProps = {
  title: string;
  children: React.ReactNode;
};

/**
 * Minimal layout without navigation or header
 * Use for: Authentication pages, error pages, standalone forms
 */
export function BaseLayout({ title, children }: BaseLayoutProps) {
  return (
    <html lang="en">
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
