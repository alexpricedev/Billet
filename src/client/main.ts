import { initializePage, registerPage } from "@client/page-lifecycle";
import { init as initAbout } from "@client/pages/about";
import { init as initContact } from "@client/pages/contact";
import { init as initExamples } from "@client/pages/examples";
import { init as initHome } from "@client/pages/home";

registerPage("home", { init: initHome });
registerPage("about", { init: initAbout });
registerPage("contact", { init: initContact });
registerPage("examples", { init: initExamples });

initializePage(document.body.dataset.page);
