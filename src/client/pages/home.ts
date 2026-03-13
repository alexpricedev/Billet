declare global {
  interface Window {
    lottie: {
      loadAnimation(params: {
        container: HTMLElement;
        renderer: string;
        loop: boolean;
        autoplay: boolean;
        path: string;
      }): void;
    };
  }
}

function startAnimation(container: HTMLElement) {
  window.lottie.loadAnimation({
    container,
    renderer: "svg",
    loop: true,
    autoplay: true,
    path: "/cube.json",
  });
  container.style.opacity = "0.55";
}

export function init() {
  const container = document.getElementById("hero-lottie");
  if (!container) return;

  if (window.lottie) {
    startAnimation(container);
    return;
  }

  const script = document.querySelector<HTMLScriptElement>(
    'script[src*="lottie"]',
  );
  if (script) {
    script.addEventListener("load", () => startAnimation(container));
  }
}
