class MyParagraph extends HTMLElement {
  constructor() {
    super();

    const template = document.getElementById(
      "custom-paragraph",
    ) as HTMLTemplateElement | null;

    if (template) {
      const templateContent = template.content;

      this.attachShadow({ mode: "open" }).appendChild(
        templateContent.cloneNode(true),
      );
    }
  }
}

customElements.define("my-paragraph", MyParagraph);
