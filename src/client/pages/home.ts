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

export function init() {
  const container = document.getElementById("hero-lottie");
  if (!container || !window.lottie) return;

  window.lottie.loadAnimation({
    container,
    renderer: "svg",
    loop: true,
    autoplay: true,
    path: "/cube.json",
  });
}
