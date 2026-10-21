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

// A fake URL never connects: every case here is decided before the database
// module is imported, so the allowed ones fail later on usage, not on the guard.
const runWithUrl = async (url: string, extra: Record<string, string> = {}) => {
  const proc = Bun.spawn(
    ["bun", "run", "scripts/persona-session.ts", "nobody"],
    {
      env: {
        ...process.env,
        NODE_ENV: "development",
        FIXTURES_ALLOW_REMOTE: "",
        DATABASE_URL: url,
        ...extra,
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stderr, code] = await Promise.all([
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stderr, code };
};

describe("local database guard", () => {
  test("a remote host is refused, and named", async () => {
    const { stderr, code } = await runWithUrl(
      "postgres://u:p@db.example.com:5432/app",
    );
    expect(code).toBe(1);
    expect(stderr).toContain("refuses to run");
    expect(stderr).toContain("db.example.com");
  });

  test.each([
    "postgres://u:p@localhost:5432/app",
    "postgres://u:p@127.0.0.1:5432/app",
    "postgres://u:p@[::1]:5432/app",
  ])("%s is allowed", async (url) => {
    const { stderr } = await runWithUrl(url);
    expect(stderr).not.toContain("refuses to run");
    expect(stderr).toContain("Unknown persona");
  });

  test("FIXTURES_ALLOW_REMOTE=1 allows a remote host", async () => {
    const { stderr } = await runWithUrl("postgres://u:p@db.example.com/app", {
      FIXTURES_ALLOW_REMOTE: "1",
    });
    expect(stderr).not.toContain("refuses to run");
  });

  test("an unparseable URL is refused", async () => {
    const { stderr, code } = await runWithUrl("not a url");
    expect(code).toBe(1);
    expect(stderr).toContain("cannot be parsed");
  });
});
