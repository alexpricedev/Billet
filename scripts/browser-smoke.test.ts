import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Subprocess } from "bun";

// Real-browser smoke tests, run via `bun run test:browser` — deliberately NOT
// part of `bun run test`, which globs `src` only. Bun.WebView is experimental
// and the engine differs by platform (system WebKit on macOS, an installed
// Chrome elsewhere), so these journeys must never gate the deterministic
// suite. What they cover is exactly what happy-dom can't:
//
// - the client bundle executing in a real page (hydration, not just parsing)
// - CSP: a blocked script passes every unit test and fails only here
// - a full form journey with trusted input events, a real session cookie,
//   and the CSRF token round-trip
//
// The server is a real subprocess against the test database, so this also
// exercises boot (migrations, seed, asset warnings) and — on teardown — the
// SIGTERM drain.

const PORT = 3987;
const BASE = `http://localhost:${PORT}`;
const SCREENSHOT_DIR = "/tmp/billet-browser-smoke";

let server: Subprocess;
let view: InstanceType<typeof Bun.WebView>;

// Every page-side console.error lands here; the last test asserts the run was
// clean. CSP violations report through the page console, which is the whole
// reason to collect them.
const pageErrors: string[] = [];

/** Poll `fn` until `pred` accepts its result or the deadline passes. */
const until = async <T>(
  fn: () => Promise<T>,
  pred: (value: T) => boolean,
  ms = 10_000,
): Promise<T> => {
  const deadline = Date.now() + ms;
  let last = await fn();
  while (!pred(last) && Date.now() < deadline) {
    await Bun.sleep(100);
    last = await fn();
  }
  return last;
};

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required (run via bun run test:browser)");
  }

  // The child gets its own port and matching APP_URL — CSRF origin validation
  // compares them exactly. Everything else is inherited from the pinned test
  // environment, so the server boots in the same modes the suite assumes.
  server = Bun.spawn(["bun", "src/server/main.ts"], {
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: String(PORT),
      APP_URL: BASE,
    },
    stdout: "ignore",
    stderr: "inherit",
  });

  // Bun.fetch, not fetch: the happy-dom preload replaces global fetch with
  // one that enforces the Same Origin Policy against its fake window.
  const ready = await until(
    () => Bun.fetch(BASE).then((res) => res.ok).catch(() => false),
    (ok) => ok === true,
    15_000,
  );
  if (!ready) throw new Error(`Server did not answer on ${BASE}`);

  view = new Bun.WebView({
    width: 1280,
    height: 900,
    console: (type, ...args) => {
      if (type === "error") pageErrors.push(args.map(String).join(" "));
    },
  });
});

afterAll(async () => {
  view?.close();
  // SIGTERM, not kill(): teardown doubles as a live check of the graceful
  // shutdown handler. A hang here means the drain regressed.
  server?.kill("SIGTERM");
  await server?.exited;
});

describe("browser smoke", () => {
  test("home renders with a title and an applied stylesheet", async () => {
    await view.navigate(`${BASE}/`);

    const title = await view.evaluate<string>("document.title");
    expect(title.length).toBeGreaterThan(0);

    // A missing or CSP-blocked stylesheet leaves styleSheets empty while the
    // HTML still renders — the classic "passes every test, unstyled in prod".
    const styleSheets = await view.evaluate<number>(
      "document.styleSheets.length",
    );
    expect(styleSheets).toBeGreaterThan(0);
  });

  test("the client bundle hydrates the forms island", async () => {
    await view.navigate(`${BASE}/forms`);

    // set only by src/client/pages/forms.ts at init — proves main.js was
    // served, passed CSP, executed, and the page registry dispatched.
    const validationMessage = await until(
      () =>
        view.evaluate<string>(
          `document.querySelector("input[name='name']")?.validationMessage ?? ""`,
        ),
      (msg) => msg.length > 0,
    );
    expect(validationMessage).toBe("Oi, enter your name.");
  });

  test("a guest submits the form through the CSRF round-trip", async () => {
    await view.navigate(`${BASE}/forms`);

    await view.click("input[name='name']");
    await view.type("Smoke Tester");
    await view.click("textarea[name='message']");
    await view.type("Filed by the browser smoke test.");
    await view.click(".form-card button[type='submit']");

    // The POST redirects back to /forms with the flash cookie set.
    const flash = await until(
      () => view.evaluate<string>("document.body.innerText"),
      (text) => text.includes("Submitted successfully"),
    );
    expect(flash).toContain("Submitted successfully");

    const { mkdirSync } = await import("node:fs");
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await Bun.write(
      `${SCREENSHOT_DIR}/forms-success.png`,
      await view.screenshot(),
    );
  });

  test("no page threw or hit a CSP violation across the run", () => {
    expect(pageErrors).toEqual([]);
  });
});
