import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { init } from "./examples";

describe("examples page init", () => {
  beforeEach(() => {
    const mount = document.createElement("div");
    mount.id = "examples-search";
    mount.dataset.examples = JSON.stringify([{ id: 1, name: "Test Example" }]);
    document.body.appendChild(mount);
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("mounts ExampleSearch into #examples-search", async () => {
    init();

    await new Promise((r) => setTimeout(r, 10));

    const mount = document.getElementById("examples-search");
    if (!mount) throw new Error("Mount not found");
    const input = mount.querySelector("input");
    expect(input).not.toBeNull();
    if (!input) throw new Error("Input not found");
    expect(input.placeholder).toBe("Search examples...");
  });

  test("does nothing when mount point is missing", () => {
    document.body.innerHTML = "";
    init();
  });
});
