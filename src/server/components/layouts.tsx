import type React from "react";

import { Nav } from "./nav";

type LayoutProps = {
  title: string;
  scriptName: string;
  children: React.ReactNode;
};

export function Layout({ title, scriptName, children }: LayoutProps) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <title>{title}</title>
        <link rel="stylesheet" href="/assets/main.css" />
      </head>
      <body data-page={scriptName}>
        <img src="/logo.png" alt="logo" />
        <Nav />
        {children}
        <script type="module" src="/assets/main.js" />
      </body>
    </html>
  );
}
