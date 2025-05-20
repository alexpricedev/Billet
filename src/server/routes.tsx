import { JSX } from "react";
import { Home } from "./templates/home";
import { About } from "./templates/about";
import { Contact } from "./templates/contact";

export const routes: Record<string, () => JSX.Element> = {
  "/": () => <Home />,
  "/about": () => <About />,
  "/contact": () => <Contact />,
};
