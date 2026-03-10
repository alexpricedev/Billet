// Page scripts
import { init as initAbout } from "@client/pages/about";
import { init as initContact } from "@client/pages/contact";
import { init as initExamples } from "@client/pages/examples";
import { init as initHome } from "@client/pages/home";

const page = document.body.dataset.page;

const pages: Record<string, () => void> = {
  home: initHome,
  about: initAbout,
  contact: initContact,
  examples: initExamples,
};

if (page && pages[page]) {
  pages[page]();
}

// Custom component scripts
import "@client/components/copy-button";
