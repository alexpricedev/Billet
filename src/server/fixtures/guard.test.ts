import { describe, expect, test } from "bun:test";

// The scripts are run for real, in a child process: the guard's whole job is to
// exit before anything else happens, and that cannot be observed in-process.
const run = async (...args: string[]) => {
  const proc = Bun.spawn(["bun", "run", ...args], {
    env: { ...process.env, NODE_ENV: "production" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, code] = await Promise.all([
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stderr, code };
};

describe("production guard", () => {
  test("fixtures refuses and says why", async () => {
    const { stderr, code } = await run("scripts/fixtures.ts");
    expect(code).toBe(1);
    expect(stderr).toContain("refuses to run with NODE_ENV=production");
  });

  test("persona-session refuses and says why", async () => {
    const { stderr, code } = await run("scripts/persona-session.ts", "priya");
    expect(code).toBe(1);
    expect(stderr).toContain("refuses to run with NODE_ENV=production");
  });
});
