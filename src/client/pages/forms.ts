export function init() {
  const form = document.querySelector("form");
  const nameInput = form?.querySelector("input[name='name']");

  if (form && nameInput) {
    const input = nameInput as HTMLInputElement;

    // Start with a custom validation message
    input.setCustomValidity("Oi, enter your name.");
    // Update it on change as needed
    input.addEventListener("input", () => {
      if (input.validity.valueMissing) {
        input.setCustomValidity("Oi, enter your name.");
      } else if (input.validity.tooShort) {
        input.setCustomValidity("Give me something more");
      } else {
        input.setCustomValidity("");
      }
    });

    form.addEventListener("submit", (e) => {
      e.preventDefault();

      const formValues = new FormData(form);
      const name = formValues.get("name");
      alert(`Form submitted! Hello, ${name} 👋`);
    });
  }
}
