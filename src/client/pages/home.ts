export function init() {
  const button = document.getElementById("counter");
  const countDisplay = document.getElementById("count");

  let count = 0;

  if (button && countDisplay) {
    button.addEventListener("click", () => {
      count++;
      countDisplay.textContent = String(count);
    });
  }
}
