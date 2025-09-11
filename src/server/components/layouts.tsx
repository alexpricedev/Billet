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
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
        <title>{title}</title>
        <link rel="stylesheet" href="/assets/tailwind.css" />
        <link rel="stylesheet" href="/assets/main.css" />
      </head>
      <body data-page={name} data-component="layout">
        <header>
          <a href="/" className="logo">
            <img src="/logo.png" alt="logo" />
          </a>
          <Nav page={name} />
        </header>
        <main className="bg-blue-500">{children}</main>
        <script type="module" src="/assets/main.js" />
      </body>
    </html>
  );
}
