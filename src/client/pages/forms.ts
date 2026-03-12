export function init() {
  const form = document.querySelector(".form-card form");
  const nameInput = form?.querySelector("input[name='name']");

  if (form && nameInput) {
    const input = nameInput as HTMLInputElement;

    input.setCustomValidity("Oi, enter your name.");
    input.addEventListener("input", () => {
      if (input.validity.valueMissing) {
        input.setCustomValidity("Oi, enter your name.");
      } else if (input.validity.tooShort) {
        input.setCustomValidity("Give me something more");
      } else {
        input.setCustomValidity("");
      }
    });
  }
}
