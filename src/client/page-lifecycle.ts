export interface PageController {
  init: () => void;
  cleanup?: () => void;
}

const controllers = new Map<string, PageController>();
let currentPage: string | null = null;

export function registerPage(name: string, controller: PageController) {
  controllers.set(name, controller);
}

export function initializePage(pageName: string | undefined) {
  if (!pageName) {
    return;
  }

  const controller = controllers.get(pageName);
  if (!controller) {
    return;
  }

  currentPage = pageName;
  controller.init();
}

export function cleanupCurrentPage() {
  if (!currentPage) {
    return;
  }

  const controller = controllers.get(currentPage);
  if (controller?.cleanup) {
    controller.cleanup();
  }

  currentPage = null;
}
