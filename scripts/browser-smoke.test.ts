import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Subprocess } from "bun";

// Real-browser smoke tests, run via `bun run test:browser`. They get a CI job
// of their own (`.github/workflows/ci.yml`, "Browser smoke") rather than a place
// in `bun run test`, which globs `src` only. Bun.WebView is experimental and the
// engine differs by platform — system WebKit on macOS, an installed Chrome on
// the Linux runner — so folding them into the deterministic suite would let a
// platform difference read as a broken diff; as their own job, a failure here is
// its own signal. What they cover is exactly what happy-dom can't:
//
// - the client bundle executing in a real page (running, not just parsing)
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

// The computed box of a select read back from the page. A dropdown also has
// where its chevron is drawn, from the left edge, or null when the browser
// reports a position that isn't a plain pixel value.
type SelectBox = {
  cursor: string;
  paddingLeft: number;
  paddingRight: number;
  backgroundImage: string;
  height: number;
};
type SelectBoxWithChevron = SelectBox & { chevronFromLeft: number | null };

// The computed box of a nav auth action, read back from the page. The two
// actions are compared against each other rather than against literals, so a
// fork can resize the header without making the assertions wrong.
type NavBox = {
  top: number;
  height: number;
  padding: string;
  borderWidth: string;
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
};

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

/**
 * Click something that may sit below the fold. Bun's selector click waits for
 * the element to be "actionable", and Chrome treats in-viewport as part of
 * that — WebKit scrolls to it, Chrome refuses — so a target that is off-screen
 * times out. The todos page grows past the fold as rows accumulate, so scroll
 * the target to the middle first. A no-op when it is already visible.
 */
const clickIntoView = async (selector: string): Promise<void> => {
  await view.scrollTo(selector, { block: "center" });
  await view.click(selector);
};

/**
 * Navigate, retrying once on net::ERR_ABORTED. The login redirect paints its
 * flash before the page finishes loading, and a navigate() issued in that
 * window is cancelled rather than failed — Chrome reports net::ERR_ABORTED,
 * WebKit waits it out. The navigation was cancelled, not rejected, so the retry
 * either lands on the page or fails for a real reason.
 */
const goto = async (url: string): Promise<void> => {
  try {
    await view.navigate(url);
  } catch (error) {
    if (!String(error).includes("ERR_ABORTED")) throw error;
    await view.navigate(url);
  }
};

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
      TEAMS_ENABLED: "true",
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

  // Bun drives an installed Chrome over CDP off macOS; macOS uses the system
  // WebKit. The Chrome the CI job installs is not the distro package — its
  // sandbox helper isn't root-owned and Ubuntu restricts unprivileged user
  // namespaces — so headless Chrome there exits before the first page ("Chrome
  // process closed the pipe") unless it skips the sandbox, which is fine for a
  // browser that only ever loads this app on localhost. A small /dev/shm makes
  // it exit the same way, hence the second flag. Neither applies to WebKit, so
  // they're set only off macOS; passing argv also forces spawn mode, so CI
  // never connects to a Chrome some other process left running.
  view = new Bun.WebView({
    width: 1280,
    height: 900,
    console: (type, ...args) => {
      if (type === "error") pageErrors.push(args.map(String).join(" "));
    },
    ...(process.platform === "darwin"
      ? {}
      : {
          backend: {
            type: "chrome" as const,
            argv: ["--no-sandbox", "--disable-dev-shm-usage"],
          },
        }),
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

  test("the client bundle runs the forms page script", async () => {
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

  test("an input, a select, a button and a ghost link in one row line up", async () => {
    await view.navigate(`${BASE}/forms`);

    // Built in the page rather than found on one, so the assertion is about
    // the base styles every fork starts from, not about whichever page happens
    // to have such a row today. Layout is the part happy-dom can't compute.
    const row = await view.evaluate<{
      heights: number[];
      bottoms: number[];
      selectWidth: number;
      chevronLeft: number | null;
      chevronSize: number;
      paddingRight: number;
      listBox: { backgroundImage: string; height: number };
    }>(`(() => {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.alignItems = "flex-start";
      row.style.gap = "8px";
      row.style.width = "900px";
      row.innerHTML =
        '<input aria-label="Email"><select aria-label="Role"><option>Member</option></select><button type="button">Send</button><a class="btn-ghost" href="#">Cancel</a>' +
        '<select multiple aria-label="Roles"><option>Member</option><option>Admin</option><option>Owner</option></select>';
      document.querySelector("main").prepend(row);
      const [input, select, button, link, listBox] = row.children;
      const boxes = [input, select, button, link].map((el) => el.getBoundingClientRect());
      const style = getComputedStyle(select);
      // Where the chevron is actually drawn, read back from the computed
      // background-position rather than from the token that feeds it, so a
      // rule that moves the image without touching the token still fails.
      // Engines serialise "right 12px" either as is or as calc(100% - 12px).
      const width = boxes[1].width;
      const size = parseFloat(style.backgroundSize);
      const posX = style.backgroundPositionX.trim();
      const fromRight = posX.match(/^right\\s+(-?[\\d.]+)px$/) ??
        posX.match(/^calc\\(100% - (-?[\\d.]+)px\\)$/);
      const fromLeft = posX.match(/^(-?[\\d.]+)px$/);
      const chevronLeft = fromRight
        ? width - parseFloat(fromRight[1]) - size
        : fromLeft
          ? parseFloat(fromLeft[1])
          : null;
      const listStyle = getComputedStyle(listBox);
      const result = {
        heights: boxes.map((box) => box.height),
        bottoms: boxes.map((box) => box.bottom),
        selectWidth: width,
        chevronLeft,
        chevronSize: size,
        paddingRight: parseFloat(style.paddingRight),
        listBox: {
          backgroundImage: listStyle.backgroundImage,
          height: listBox.getBoundingClientRect().height,
        },
      };
      row.remove();
      return result;
    })()`);

    const [inputHeight, selectHeight, buttonHeight, linkHeight] = row.heights;
    expect(selectHeight).toBe(inputHeight);
    expect(buttonHeight).toBe(inputHeight);
    // A Cancel or Remove link beside a Save button takes the same box.
    expect(linkHeight).toBe(inputHeight);
    expect(new Set(row.bottoms).size).toBe(1);
    // flex: none — a select in a 900px row stays at its content width rather
    // than stretching and stranding its chevron at the far edge.
    expect(row.selectWidth).toBeLessThan(300);
    // The chevron is drawn inside the padding reserved for it, so option text
    // can never run underneath it, and it doesn't touch the right edge.
    expect(row.chevronLeft).not.toBeNull();
    const chevronLeft = row.chevronLeft as number;
    expect(chevronLeft).toBeGreaterThanOrEqual(
      row.selectWidth - row.paddingRight,
    );
    expect(chevronLeft + row.chevronSize).toBeLessThan(row.selectWidth);
    // A list box keeps its rows: no chevron, and not squeezed to one control.
    expect(row.listBox.backgroundImage).toBe("none");
    expect(row.listBox.height).not.toBe(inputHeight);
  });

  test("a select's list-box, disabled and right-to-left cases", async () => {
    await view.navigate(`${BASE}/forms`);

    // The base rule draws one select for every case a page can hand it. These
    // are the ones a restyled select usually gets wrong: a list box is not a
    // dropdown (no chevron, no space reserved for one, and the cursor a list is
    // read with rather than a pointer), `appearance: none` took the platform's
    // disabled treatment with it, and the drawn chevron is placed physically so
    // a right-to-left document needs it on the other edge.
    const report = await view.evaluate<{
      listBox: SelectBox;
      sizeBox: SelectBox;
      dropdown: SelectBoxWithChevron;
      disabled: { color: string; cursor: string };
      enabled: { color: string };
      rtl: SelectBoxWithChevron;
    }>(`(() => {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.alignItems = "flex-start";
      row.style.gap = "8px";
      row.innerHTML =
        '<select aria-label="Roles" multiple><option>Member</option><option>Admin</option></select>' +
        '<select aria-label="Role" size="2"><option>Member</option><option>Admin</option></select>' +
        '<select aria-label="One row" size="1"><option>Member</option></select>' +
        '<select aria-label="Frozen" disabled><option>Member</option></select>' +
        '<select aria-label="Live"><option>Member</option></select>';
      document.querySelector("main").prepend(row);
      const host = document.createElement("div");
      host.dir = "rtl";
      host.innerHTML = '<select aria-label="RTL"><option>Member</option></select>';
      document.querySelector("main").prepend(host);
      const [listBox, sizeBox, oneRow, disabled, enabled] = row.children;
      const rtl = host.querySelector("select");
      const style = (el) => getComputedStyle(el);
      const px = (el, side) => parseFloat(style(el)[side]);
      const asLeft = (el) => {
        const value = style(el).backgroundPositionX.trim();
        const match = value.match(/^(-?[\\d.]+)px$/);
        return match ? parseFloat(match[1]) : null;
      };
      const box = (el, position) => ({
        cursor: style(el).cursor,
        paddingLeft: px(el, "paddingLeft"),
        paddingRight: px(el, "paddingRight"),
        backgroundImage: style(el).backgroundImage,
        height: el.getBoundingClientRect().height,
        ...(position ? { chevronFromLeft: asLeft(el) } : {}),
      });
      return {
        listBox: box(listBox),
        sizeBox: box(sizeBox),
        dropdown: box(oneRow, true),
        disabled: { color: style(disabled).color, cursor: style(disabled).cursor },
        enabled: { color: style(enabled).color },
        rtl: box(rtl, true),
      };
    })()`);

    // A list box, at every size: no chevron, no reserved edge, list cursor.
    for (const box of [report.listBox, report.sizeBox]) {
      expect(box.backgroundImage).toBe("none");
      expect(box.paddingRight).toBe(box.paddingLeft);
      expect(box.cursor).toBe("default");
    }
    expect(report.listBox.height).toBeGreaterThan(report.dropdown.height);

    // size="1" is a dropdown like any other.
    expect(report.dropdown.backgroundImage).not.toBe("none");
    expect(report.dropdown.paddingRight).toBeGreaterThan(report.dropdown.paddingLeft);
    expect(report.dropdown.cursor).toBe("pointer");

    // Disabled: muted, and not a pointer. The enabled select beside it is the
    // control — the assertion means nothing if it is muted too.
    expect(report.disabled.color).not.toBe(report.enabled.color);
    expect(report.disabled.cursor).toBe("default");

    // Right-to-left: the chevron moves to the inline-end edge (the left) and
    // the space reserved for it moves with it.
    expect(report.rtl.chevronFromLeft).not.toBeNull();
    expect(report.rtl.paddingLeft).toBe(report.dropdown.paddingRight);
    expect(report.rtl.paddingRight).toBe(report.dropdown.paddingLeft);
    expect(report.rtl.chevronFromLeft as number).toBeLessThan(report.rtl.paddingLeft);
  });

  test("the home page's ghost CTA is the shared ghost button in a bigger box", async () => {
    await view.navigate(`${BASE}/`);

    // The hero's "View Stack" used to carry its own copy of .btn-ghost's
    // colours, border, hover background and underline reset. It takes them from
    // base.css now, and keeps only the box its row needs — so a ghost button is
    // drawn in one place, and the CTA still looks like the CTA. The probe link
    // is a second ghost link in the same row, with an href that goes nowhere,
    // so hovering it tests the resting and hover rules the copy used to carry.
    const report = await view.evaluate<{
      hero: Record<string, string>;
      plain: Record<string, string>;
    }>(`(() => {
      const hero = document.querySelector(".hero-actions a.btn-ghost");
      const plain = document.createElement("a");
      plain.className = "btn-ghost";
      plain.href = "#";
      plain.textContent = "Plain";
      document.querySelector("main").prepend(plain);
      const probe = document.createElement("a");
      probe.id = "smoke-hero-ghost";
      probe.className = "btn-ghost";
      probe.href = "#";
      probe.textContent = "Probe";
      document.querySelector(".hero-actions").append(probe);
      const read = (el) => {
        const s = getComputedStyle(el);
        return {
          color: s.color,
          background: s.backgroundColor,
          border: s.borderTopWidth + " " + s.borderTopStyle + " " + s.borderTopColor,
          fontWeight: s.fontWeight,
          padding: s.paddingTop + " " + s.paddingRight,
          height: el.getBoundingClientRect().height,
        };
      };
      const result = { hero: read(hero), plain: read(plain) };
      plain.remove();
      return result;
    })()`);

    // The same button: base.css draws the colours, border and weight in both.
    expect(report.hero.color).toBe(report.plain.color);
    expect(report.hero.background).toBe(report.plain.background);
    expect(report.hero.border).toBe(report.plain.border);
    expect(report.hero.fontWeight).toBe(report.plain.fontWeight);
    // The hero's own box is what makes it the bigger CTA.
    expect(Number(report.hero.height)).toBeGreaterThan(Number(report.plain.height));
    expect(report.hero.padding).not.toBe(report.plain.padding);

    // And the hover: the surface fills in and the link does not sprout the
    // underline a plain link gets. A hash href, so the click stays on the page.
    await view.click("#smoke-hero-ghost");
    await Bun.sleep(250);
    const hovered = await view.evaluate<{
      color: string;
      background: string;
      decoration: string;
    }>(`(() => {
      const s = getComputedStyle(document.querySelector("#smoke-hero-ghost"));
      return {
        color: s.color,
        background: s.backgroundColor,
        decoration: s.textDecorationLine,
      };
    })()`);
    expect(hovered.background).not.toBe(report.hero.background);
    expect(hovered.color).not.toBe(report.hero.color);
    expect(hovered.decoration).toBe("none");
    await view.evaluate(`document.querySelector("#smoke-hero-ghost")?.remove()`);
  });

  test("a link styled as a button takes the button's box", async () => {
    await view.navigate(`${BASE}/forms`);

    // /team pairs an <a class="btn-ghost"> (Remove, in the members row) with a
    // <button class="btn-ghost"> (Revoke, in the invitations row), one above
    // the other; the anchor's text sits against its border unless the link
    // draws the button's padding and radius too. Built in the page rather than
    // found on one, so the assertion is about the base styles every fork
    // starts from — the same reasoning as the row test above.
    const boxes = await view.evaluate<Record<string, number>[]>(`(() => {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.gap = "8px";
      row.innerHTML =
        '<button type="button" class="btn-ghost">Revoke</button>' +
        '<a class="btn-ghost" href="#">Remove</a>' +
        '<button type="button" class="btn-danger">Delete</button>' +
        '<a class="btn-danger" href="#">Delete</a>';
      document.querySelector("main").prepend(row);
      const box = (el) => {
        const style = getComputedStyle(el);
        return {
          height: el.getBoundingClientRect().height,
          paddingTop: parseFloat(style.paddingTop),
          paddingLeft: parseFloat(style.paddingLeft),
          borderRadius: parseFloat(style.borderTopLeftRadius),
          borderWidth: parseFloat(style.borderTopWidth),
          fontSize: parseFloat(style.fontSize),
          fontWeight: Number(style.fontWeight),
          lineHeight: parseFloat(style.lineHeight),
        };
      };
      const result = Array.from(row.children).map(box);
      row.remove();
      return result;
    })()`);

    const [ghostButton, ghostLink, dangerButton, dangerLink] = boxes;
    expect(ghostLink).toEqual(ghostButton);
    expect(dangerLink).toEqual(dangerButton);
  });

  test("a hovered danger link keeps the danger colour", async () => {
    await view.navigate(`${BASE}/forms`);

    // The global a:hover colour is more specific than a lone .btn-danger rule,
    // so a hovered danger link turns indigo unless its state re-states the
    // colour — the bug this guards. A plain link beside it is the control: it
    // must still change colour on hover, or :hover never applied and the
    // assertion would pass for the wrong reason. getComputedStyle reads the
    // colour mid-transition (a carries a 150ms colour transition), so wait it
    // out before reading.
    await view.evaluate(`(() => {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.gap = "8px";
      row.innerHTML =
        '<a id="smoke-danger" class="btn-danger" href="#">Delete</a>' +
        '<a id="smoke-plain" href="#">Plain</a>';
      document.querySelector("main").prepend(row);
    })()`);

    const colour = (id: string): Promise<string> =>
      view.evaluate<string>(
        `getComputedStyle(document.querySelector("#${id}")).color`,
      );

    const dangerResting = await colour("smoke-danger");
    const plainResting = await colour("smoke-plain");

    // A native click parks the pointer on the link, so :hover matches it.
    await view.click("#smoke-danger");
    await Bun.sleep(250);
    const dangerHovered = await colour("smoke-danger");

    await view.click("#smoke-plain");
    await Bun.sleep(250);
    const plainHovered = await colour("smoke-plain");

    // The danger link keeps the danger colour on hover...
    expect(dangerHovered).toBe(dangerResting);
    // ...and the control proves hover really changed a colour in this browser.
    expect(plainHovered).not.toBe(plainResting);
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

  test("the todo list adds, toggles and filters without a page load", async () => {
    await view.navigate(`${BASE}/todos`);

    // The filters ship hidden and are revealed by data-mounted, which only
    // the bundle sets — so their appearance proves main.js ran and mount()
    // found the component under the CSP.
    const mounted = await until(
      () =>
        view.evaluate<boolean>(
          `document.querySelector('[data-component="todo-list"]')?.hasAttribute("data-mounted") ?? false`,
        ),
      (ok) => ok === true,
    );
    expect(mounted).toBe(true);

    // A marker on window survives only if the page is never reloaded. Every
    // assertion below that reads it is asserting "no navigation happened".
    await view.evaluate(`window.__smoke = "same page"`);
    const rowsBefore = await view.evaluate<number>(
      `document.querySelectorAll("tbody tr[data-id]").length`,
    );

    // Add: the form's submit is intercepted, the server answers with the
    // row, and it lands in the table with trusted key events all the way.
    const title = `Smoke ${Date.now()}`;
    await view.click("#todo-title");
    await view.type(title);
    await view.click(".todo-form button[type='submit']");
    const rowsAfter = await until(
      () =>
        view.evaluate<number>(
          `document.querySelectorAll("tbody tr[data-id]").length`,
        ),
      (n) => n === rowsBefore + 1,
    );
    expect(rowsAfter).toBe(rowsBefore + 1);
    expect(await view.evaluate<string>(`window.__smoke`)).toBe("same page");

    const newId = await view.evaluate<string>(
      `Array.from(document.querySelectorAll("tbody tr[data-id]")).find((tr) => tr.querySelector(".todo-title")?.textContent === ${JSON.stringify(title)})?.dataset.id ?? ""`,
    );
    expect(newId).not.toBe("");
    const rowSelector = `tbody tr[data-id="${newId}"]`;
    const countBefore = await view.evaluate<string>(
      `document.querySelector(".todo-count")?.textContent ?? ""`,
    );

    // Toggle: the row is swapped for the server's completed version, and the
    // count follows.
    await clickIntoView(`${rowSelector} .toggle-btn`);
    const completed = await until(
      () =>
        view.evaluate<boolean>(
          `document.querySelector('${rowSelector}')?.hasAttribute("data-completed") ?? false`,
        ),
      (ok) => ok === true,
    );
    expect(completed).toBe(true);
    const countAfter = await view.evaluate<string>(
      `document.querySelector(".todo-count")?.textContent ?? ""`,
    );
    expect(countAfter).not.toBe(countBefore);
    expect(await view.evaluate<string>(`window.__smoke`)).toBe("same page");

    // Filter: Active hides the row just completed; All brings it back.
    await clickIntoView(".todo-filters button:nth-of-type(2)");
    const hidden = await until(
      () =>
        view.evaluate<boolean>(
          `document.querySelector('${rowSelector}')?.hidden ?? false`,
        ),
      (ok) => ok === true,
    );
    expect(hidden).toBe(true);
    await clickIntoView(".todo-filters button:nth-of-type(1)");
    const shown = await until(
      () =>
        view.evaluate<boolean>(
          `document.querySelector('${rowSelector}')?.hidden === false`,
        ),
      (ok) => ok === true,
    );
    expect(shown).toBe(true);

    // The assertions above are DOM state, which a component test can make too.
    // This is the one a component test cannot: a real stylesheet is loaded, so
    // `display` is the resolved value and a rule that outranked `hidden` would
    // show up here. It is why `data-show` writes an inline display as well.
    await clickIntoView(".todo-filters button:nth-of-type(2)");
    const collapsed = await until(
      () =>
        view.evaluate<string>(
          `getComputedStyle(document.querySelector('${rowSelector}')).display`,
        ),
      (value) => value === "none",
    );
    expect(collapsed).toBe("none");
    await clickIntoView(".todo-filters button:nth-of-type(1)");

    expect(await view.evaluate<string>(`window.__smoke`)).toBe("same page");
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

    // The flash text is in the document as soon as the redirect paints, which
    // can be before the login page has finished loading. Let it settle, then
    // load the link — a navigate() that starts mid-load is cancelled
    // (net::ERR_ABORTED), which `goto` also absorbs.
    await until(
      () =>
        view.evaluate<string>("document.readyState").catch(() => "loading"),
      (state) => state === "complete",
      5_000,
    );

    // Emailed links render a confirm step on GET and spend the token on POST —
    // mail scanners follow links, they don't submit forms. Loading the link
    // twice must leave the token intact, or a scanner would burn it before
    // the recipient ever clicked. Two loads, not load+reload(): WebKit left the
    // confirm click inert after a reload().
    await goto(`${BASE}${link}`);
    await goto(`${BASE}${link}`);
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

  test("the nav's Account link and Logout button take the same box", async () => {
    // Continues signed in from the magic link above. `.nav-auth` styles the
    // auth actions as the header's own controls — no border, and a smaller box
    // once the phone layout takes over — and the header shows an <a> beside a
    // <button> inside a <form>, which is two ways to arrive at a box. Whatever
    // that treatment is, the two must agree in every state. The boxes are
    // compared against each other rather than against literals, so a fork can
    // resize the nav without the assertion becoming wrong.
    const readNav = (): Promise<{ anchor: NavBox; button: NavBox }> =>
      view.evaluate(`(() => {
        const auth = document.querySelector(".nav-auth");
        const anchor = auth.querySelector("a.btn-ghost");
        const button = auth.querySelector("button.btn-ghost");
        const box = (el) => {
          const s = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          return {
            top: r.top,
            height: r.height,
            padding: s.paddingTop + " " + s.paddingRight,
            borderWidth: s.borderTopWidth,
            fontSize: s.fontSize,
            fontWeight: s.fontWeight,
            lineHeight: s.lineHeight,
          };
        };
        return { anchor: box(anchor), button: box(button) };
      })()`);
    const agree = ({ anchor, button }: { anchor: NavBox; button: NavBox }) =>
      anchor.height === button.height &&
      anchor.padding === button.padding &&
      anchor.borderWidth === button.borderWidth;

    // Desktop: the header's own treatment, applied to both. A row, so they
    // share a baseline as well as a box.
    await view.navigate(`${BASE}/`);
    const desktop = await readNav();
    expect(desktop.anchor).toEqual(desktop.button);

    // The phone header with JS: the toggle opens the panel, which re-pads both
    // into full-width rows. Driven by a real click rather than a hand-set
    // attribute — an attribute the engine has just been told to stop matching
    // on is not recomputed until the next frame, and a read in between returns
    // the previous box for one of the two elements.
    await view.resize(390, 844);
    await view.click(".nav-toggle");
    await until(
      () =>
        view.evaluate<string>(
          `getComputedStyle(document.querySelector(".nav-panel")).display`,
        ),
      (display) => display === "flex",
    );
    const panel = await readNav();
    // Stacked rows, so only the box is shared — the tops differ by design.
    expect(agree(panel), JSON.stringify(panel)).toBe(true);
    expect(panel.anchor.height).toBeGreaterThan(desktop.anchor.height);

    // The no-JS fallback: no panel, so the pages and the auth actions share the
    // wrapped header row. Both still take the same box, top included. Poll for
    // the fallback to take effect rather than read the panel's box back.
    await view.evaluate(
      `document.querySelector('[data-component="nav"]').removeAttribute("data-nav-enhanced")`,
    );
    const fallback = await until(
      readNav,
      (boxes) => agree(boxes) && boxes.anchor.height < panel.anchor.height,
    );
    expect(fallback.anchor).toEqual(fallback.button);

    await view.resize(1280, 900);
  });

  test("/team fits a phone screen without scrolling sideways", async () => {
    // Continues signed in from the magic link above. A long unbroken address
    // in the invitations table is the widest row the page can render; on a
    // plain four-column table it pushed the page past 390px.
    await view.navigate(`${BASE}/team`);
    await view.click("#team-name");
    await view.type("Smoke team");
    await clickThrough("form.team-create button");
    await until(bodyText, (text) => text.includes("Invite someone"));

    await view.click("#invite-email");
    await view.type(`a-very-long-invitee-address-${Date.now()}@example.com`);
    await clickThrough("form.team-invite button");
    await until(bodyText, (text) => text.includes("Pending invitations"));

    await view.resize(390, 844);
    // Measure against the layout viewport, not the window. A phone's scrollbar
    // floats over the page and takes no width; a desktop browser reserves it —
    // and `scrollbar-gutter: stable` on `html` reserves one before it is even
    // needed — so the CI runner's Chrome lays the page out 15px narrower than
    // its 390px window. `scrollWidth` over `clientWidth` is the browser's own
    // test for "this page scrolls sideways": past that line a horizontal
    // scrollbar appears. Since the layout viewport is never wider than the
    // window, passing it also means the page fits a 390px phone.
    const [content, layout, viewport] = await until(
      () =>
        view.evaluate<[number, number, number]>(
          "[document.documentElement.scrollWidth, document.documentElement.clientWidth, window.innerWidth]",
        ),
      ([scroll, client, inner]) => inner === 390 && scroll <= client,
    );
    expect(viewport).toBe(390);
    expect(content).toBeLessThanOrEqual(layout);
    await view.resize(1280, 900);
  });

  test("no page threw or hit a CSP violation across the run", () => {
    expect(pageErrors).toEqual([]);
  });
});
