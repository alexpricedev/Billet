import type React from "react";

import { Nav } from "./nav";

type LayoutProps = {
  title: string;
  name: string;
  children: React.ReactNode;
};

export function Layout({ title, name, children }: LayoutProps) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
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
