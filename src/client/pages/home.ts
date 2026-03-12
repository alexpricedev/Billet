import lottie from "lottie-web";

export function init() {
  const container = document.getElementById("hero-lottie");
  if (!container) return;

  lottie.loadAnimation({
    container,
    renderer: "svg",
    loop: true,
    autoplay: true,
    path: "/cube.json",
  });
}
