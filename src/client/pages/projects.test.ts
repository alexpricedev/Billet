import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { init } from "./projects";

describe("projects page init", () => {
  beforeEach(() => {
    const mount = document.createElement("div");
    mount.id = "projects-search";
    mount.dataset.projects = JSON.stringify([{ id: 1, title: "Test Project" }]);
    document.body.appendChild(mount);
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("mounts ProjectSearch into #projects-search", async () => {
    init();

    await new Promise((r) => setTimeout(r, 10));

    const mount = document.getElementById("projects-search");
    if (!mount) throw new Error("Mount not found");
    const input = mount.querySelector("input");
    expect(input).not.toBeNull();
    if (!input) throw new Error("Input not found");
    expect(input.placeholder).toBe("Search projects...");
  });

  test("does nothing when mount point is missing", () => {
    document.body.innerHTML = "";
    init();
  });
});
