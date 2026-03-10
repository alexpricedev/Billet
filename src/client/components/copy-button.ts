class CopyButton extends HTMLElement {
  static observedAttributes = ["value"];

  #button: HTMLButtonElement | null = null;
  #timeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super();

    const template = document.getElementById(
      "copy-button-template",
    ) as HTMLTemplateElement | null;

    if (template) {
      this.attachShadow({ mode: "open" }).appendChild(
        template.content.cloneNode(true),
      );
      this.#button = this.shadowRoot?.querySelector("button") ?? null;
    }
  }

  connectedCallback() {
    this.#button?.addEventListener("click", this.#handleClick);
  }

  disconnectedCallback() {
    this.#button?.removeEventListener("click", this.#handleClick);
    if (this.#timeout) clearTimeout(this.#timeout);
  }

  attributeChangedCallback(name: string, _old: string, next: string) {
    if (name === "value" && this.#button) {
      this.#button.dataset.value = next;
    }
  }

  #handleClick = async () => {
    const value = this.getAttribute("value") ?? "";
    await navigator.clipboard.writeText(value);

    if (this.#button) {
      this.#button.classList.add("copied");
      this.#button.setAttribute("aria-label", "Copied!");

      if (this.#timeout) clearTimeout(this.#timeout);
      this.#timeout = setTimeout(() => {
        this.#button?.classList.remove("copied");
        this.#button?.setAttribute("aria-label", "Copy to clipboard");
      }, 1500);
    }
  };
}

customElements.define("copy-button", CopyButton);
