import { init as initNavMenu } from "@client/components/nav-menu";
import { initializePage, registerPage } from "@client/page-lifecycle";
import { init as initForms } from "@client/pages/forms";
import { init as initHome } from "@client/pages/home";
import { init as initProjects } from "@client/pages/projects";
import { init as initStack } from "@client/pages/stack";

registerPage("home", { init: initHome });
registerPage("stack", { init: initStack });
registerPage("forms", { init: initForms });
registerPage("projects", { init: initProjects });

// The nav is on every page, so it runs outside the per-data-page registry.
initNavMenu();

initializePage(document.body.dataset.page);
