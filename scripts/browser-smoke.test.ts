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

// Everything the server prints, accumulated as it arrives. The magic-link
// journey scrapes the console email provider's output for the emailed URL —
// the same place a developer reads it from in local dev.
let serverLog = "";

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

/**
 * Body text, tolerant of an in-flight navigation: WebKit rejects an evaluate
 * whose page goes away mid-call ("completion handler no longer reachable"),
 * which is the normal state right after clicking a submit button. Poll through
 * it — the next attempt lands on the new page.
 */
const bodyText = (): Promise<string> =>
  view.evaluate<string>("document.body.innerText").catch(() => "");

/**
 * Click something that navigates. The navigation itself can tear down the
 * click's completion handler (same WebKit behaviour as above), and the
 * navigation is the outcome the caller polls for — so a lost handler is not
 * a failure.
 */
const clickThrough = (selector: string): Promise<void> =>
  view.click(selector).catch(() => {});

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required (run via bun run test:browser)");
  }

  // The child gets its own port and matching APP_URL — CSRF origin validation
  // compares them exactly. Everything else is inherited from the pinned test
  // environment, except the captcha: it's on, because solving the proof of
  // work in a real page is half the reason this file exists.
  server = Bun.spawn(["bun", "src/server/main.ts"], {
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: String(PORT),
      APP_URL: BASE,
      CAPTCHA_ENABLED: "true",
    },
    stdout: "pipe",
    stderr: "inherit",
  });

  (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of server.stdout as ReadableStream<Uint8Array>) {
      serverLog += decoder.decode(chunk);
    }
  })();

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
    await clickThrough(".form-card button[type='submit']");

    // The POST redirects back to /forms with the flash cookie set.
    const flash = await until(
      bodyText,
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

  test("the captcha solves its proof of work in the page", async () => {
    await view.navigate(`${BASE}/login`);

    // captcha.ts brute-forces the challenge with its own SHA-256 and writes
    // the payload into the hidden field — the one loop happy-dom only ever
    // exercises synthetically. "Verified." is set only after a solve the
    // server-side verifier would accept.
    const status = await until(
      () =>
        view.evaluate<string>(
          `document.querySelector(".captcha-status")?.textContent ?? ""`,
        ),
      (text) => text === "Verified.",
      20_000,
    );
    expect(status).toBe("Verified.");

    const solution = await view.evaluate<string>(
      `document.querySelector("input[name='captcha_solution']")?.value ?? ""`,
    );
    expect(solution.length).toBeGreaterThan(0);
  });

  test("a magic link signs in end to end, and GET does not redeem it", async () => {
    const email = `smoke-${Date.now()}@example.com`;

    // Continues from the solved captcha above — a real login submit carries
    // the proof of work with it.
    await view.click("input[name='email']");
    await view.type(email);
    await clickThrough("button.login-submit");

    await until(
      bodyText,
      (text) => text.includes("Check your email"),
    );

    // The console email provider prints the message to the server's stdout;
    // scrape the emailed URL from there, like a developer would in local dev.
    const log = await until(
      () => Promise.resolve(serverLog),
      (text) => text.includes(`/auth/callback?token=`) && text.includes(email),
    );
    const link = log.match(/\/auth\/callback\?token=[^"'\s&]+/)?.[0];
    if (!link) throw new Error("No magic link in the server log");

    // Emailed links render a confirm step on GET and spend the token on POST —
    // mail scanners follow links, they don't submit forms. Loading the link
    // twice must leave the token intact, or a scanner would burn it before
    // the recipient ever clicked.
    await view.navigate(`${BASE}${link}`);
    await view.navigate(`${BASE}${link}`);
    const confirm = await view.evaluate<boolean>(
      `!!document.querySelector("form button.login-submit")`,
    );
    expect(confirm).toBe(true);

    await clickThrough("form button.login-submit");
    const signedIn = await until(
      bodyText,
      (text) => text.includes("Logout"),
    );
    expect(signedIn).toContain("Logout");
  });

  test("no page threw or hit a CSP violation across the run", () => {
    expect(pageErrors).toEqual([]);
  });
});
