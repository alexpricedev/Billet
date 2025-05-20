import type { JSX } from "react";

import { About } from "./templates/about";
import { Contact } from "./templates/contact";
import { Home } from "./templates/home";

export const routes: Record<string, (req: Request) => JSX.Element> = {
  "/": (req) => {
    // get the query params
    const url = new URL(req.url);
    const params = new URLSearchParams(url.search);
    const method = params.get("method");
    return <Home method={method || "missing"} />;
  },
  "/about": () => <About />,
  "/contact": () => <Contact />,
};
