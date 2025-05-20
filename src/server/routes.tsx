import type { JSX } from "react";

import { About } from "./templates/about";
import { Contact } from "./templates/contact";
import { Home } from "./templates/home";

export const routes: Record<string, (req: Request) => JSX.Element> = {
  "/": (req) => <Home method={req.method} />,
  "/about": () => <About />,
  "/contact": () => <Contact />,
};
