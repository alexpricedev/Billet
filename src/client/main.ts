import "./style.css";

import { init as initHome } from "@client/pages/home";
import { init as initAbout } from "@client/pages/about";
import { init as initContact } from "@client/pages/contact";

const page = document.body.dataset.page;

const pages: Record<string, () => void> = {
  home: initHome,
  about: initAbout,
  contact: initContact,
};

pages[page!]?.();
