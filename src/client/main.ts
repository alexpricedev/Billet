import { init as initFlashDismiss } from "@client/components/flash-dismiss";
import { init as initNavMenu } from "@client/components/nav-menu";
import { init as initThemeToggle } from "@client/components/theme-toggle";
import { todoList } from "@client/components/todo-list";
import { initializePage, registerPage } from "@client/page-lifecycle";
import { init as initForms } from "@client/pages/forms";
import { init as initStack } from "@client/pages/stack";
import * as ui from "@client/reactive";

registerPage("stack", { init: initStack });
registerPage("forms", { init: initForms });

// Components bind to whichever page renders their data-component root, so
// they register once here rather than per page.
ui.registerComponent(todoList);

// The nav and the theme toggle are on every page with chrome, so they run
// outside the per-data-page registry.
initNavMenu();
initThemeToggle();
initFlashDismiss();

initializePage(document.body.dataset.page);
ui.mount();
