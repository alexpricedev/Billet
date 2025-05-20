import "./style.css";

import { init as initHome } from "./pages/home";
import { init as initAbout } from "./pages/about";
import { init as initContact } from "./pages/contact";

const page = document.body.dataset.page;

const pages: Record<string, () => void> = {
  home: initHome,
  about: initAbout,
  contact: initContact,
};

pages[page!]?.();
