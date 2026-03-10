import { ExampleSearch } from "@client/components/example-search";
import { h, render } from "preact";

export function init() {
  const mount = document.getElementById("examples-search");
  const list = document.getElementById("examples-list");
  if (!mount || !list) return;

  const total = list.children.length;
  render(h(ExampleSearch, { total }), mount);
}
