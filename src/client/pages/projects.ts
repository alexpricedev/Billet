import { ProjectSearch } from "@client/components/project-search";
import { h, render } from "preact";

export function init() {
  const mount = document.getElementById("projects-search");
  if (!mount) return;

  const raw = mount.dataset.projects;
  const projects = raw ? JSON.parse(raw) : [];
  render(h(ProjectSearch, { projects }), mount);
}
