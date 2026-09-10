import { init as initNavMenu } from "@client/components/nav-menu";
import { todoList } from "@client/components/todo-list";
import { initializePage, registerPage } from "@client/page-lifecycle";
import { init as initForms } from "@client/pages/forms";
import { init as initHome } from "@client/pages/home";
import { init as initStack } from "@client/pages/stack";
import * as ui from "@client/reactive";

registerPage("home", { init: initHome });
registerPage("stack", { init: initStack });
registerPage("forms", { init: initForms });

// Components bind to whichever page renders their data-component root, so
// they register once here rather than per page.
ui.registerComponent(todoList);

// The nav is on every page, so it runs outside the per-data-page registry.
initNavMenu();

initializePage(document.body.dataset.page);
ui.mount();
