import { init as initAbout } from "@client/pages/about";
import { init as initContact } from "@client/pages/contact";
import { init as initHome } from "@client/pages/home";

import "./style.css";

const page = document.body.dataset.page;

const pages: Record<string, () => void> = {
  home: initHome,
  about: initAbout,
  contact: initContact,
};

if (page && pages[page]) {
  pages[page]();
}
