import { ExampleSearch } from "@client/components/example-search";
import { h, render } from "preact";

export function init() {
  const mount = document.getElementById("examples-search");
  if (!mount) return;

  const raw = mount.dataset.examples;
  const examples = raw ? JSON.parse(raw) : [];
  render(h(ExampleSearch, { examples }), mount);
}
