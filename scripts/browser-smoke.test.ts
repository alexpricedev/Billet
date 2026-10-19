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
 * WCAG relative-luminance contrast ratio for two computed CSS colours
 * ("rgb(r, g, b)"). The accessibility assertions below read the real
 * stylesheet's computed values and check the ratio, rather than asserting the
 * token names — a fork can retune the palette and the numbers still have to
 * clear the floor.
 */
const relativeLuminance = (css: string): number => {
  const [r, g, b] = (css.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  const channel = (value: number): number => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

const contrastRatio = (a: string, b: string): number => {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x,
  );
  return (hi + 0.05) / (lo + 0.05);
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

  test("the home page plays its animation from a same-origin Lottie script", async () => {
    await view.navigate(`${BASE}/`);

    const hasLottie = await until(
      () => view.evaluate<boolean>('typeof window.lottie === "object"'),
      (loaded) => loaded,
    );
    expect(hasLottie).toBe(true);

    const src = await view.evaluate<string>(
      `new URL(document.querySelector("script[src*='lottie']").src).pathname`,
    );
    expect(src.startsWith("/assets/")).toBe(true);

    const rendered = await until(
      () =>
        view.evaluate<boolean>(`!!document.querySelector("#hero-lottie svg")`),
      (found) => found,
    );
    expect(rendered).toBe(true);
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
    // flex: 0 1 auto — a select in a 900px row stays at its content width
    // rather than stretching and stranding its chevron at the far edge. It can
    // still shrink when the row is too narrow; that is the 390px test below.
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

  test("a long option doesn't push its button off a 390 screen", async () => {
    await view.navigate(`${BASE}/forms`);
    await view.resize(390, 844);

    // A select holds its content width in a flex row, and a long option makes
    // that wider than a phone. Without `min-width: 0` the select's automatic
    // minimum is the option's width, so it fills the row and shoves the button
    // past the edge; with the shrink allowed, the button stays in the viewport.
    // Built in the page so the assertion is about the base styles every fork
    // starts from, not about a page that happens to fit today.
    const report = await view.evaluate<{
      buttonRight: number;
      viewport: number;
      selectWidth: number;
    }>(`(() => {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.alignItems = "flex-start";
      row.style.gap = "8px";
      row.style.width = "100%";
      row.innerHTML =
        '<select aria-label="Role"><option>A role name long enough to overflow a phone screen</option></select>' +
        '<button type="button">Save</button>';
      document.querySelector("main").prepend(row);
      const [select, button] = row.children;
      const result = {
        buttonRight: button.getBoundingClientRect().right,
        viewport: window.innerWidth,
        selectWidth: select.getBoundingClientRect().width,
      };
      row.remove();
      return result;
    })()`);

    expect(report.viewport).toBe(390);
    expect(report.buttonRight).toBeLessThanOrEqual(report.viewport);
    expect(report.selectWidth).toBeLessThan(report.viewport);

    await view.resize(1280, 900);
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
      sizeZero: SelectBox;
      sizeEmpty: SelectBox;
      dropdown: SelectBoxWithChevron;
      disabled: { opacity: string; cursor: string; color: string };
      disabledListBox: { cursor: string };
      enabled: { opacity: string; color: string };
      rtl: SelectBoxWithChevron;
      ltrInRtl: {
        backgroundImage: string;
        placedRight: boolean;
        paddingLeft: number;
        paddingRight: number;
      }[];
    }>(`(() => {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.alignItems = "flex-start";
      row.style.gap = "8px";
      row.innerHTML =
        '<select aria-label="Roles" multiple><option>Member</option><option>Admin</option></select>' +
        '<select aria-label="Role" size="2"><option>Member</option><option>Admin</option></select>' +
        '<select aria-label="Size zero" size="0"><option>Member</option></select>' +
        '<select aria-label="One row" size="1"><option>Member</option></select>' +
        '<select aria-label="Empty size" size=""><option>Member</option></select>' +
        '<select aria-label="Frozen" disabled><option>Member</option></select>' +
        '<select aria-label="Frozen list" size="3" disabled><option>Member</option><option>Admin</option><option>Owner</option></select>' +
        '<select aria-label="Live"><option>Member</option></select>';
      document.querySelector("main").prepend(row);
      const host = document.createElement("div");
      host.dir = "rtl";
      host.innerHTML =
        '<select aria-label="RTL"><option>Member</option></select>' +
        '<select aria-label="LTR in RTL" dir="ltr"><option>Member</option></select>' +
        '<div dir="ltr"><select aria-label="LTR subtree in RTL"><option>Member</option></select></div>';
      document.querySelector("main").prepend(host);
      const [listBox, sizeBox, sizeZero, oneRow, sizeEmpty, disabled, disabledListBox, enabled] = row.children;
      const rtl = host.querySelector('select[aria-label="RTL"]');
      const ltrInRtl = [
        host.querySelector('select[aria-label="LTR in RTL"]'),
        host.querySelector('select[aria-label="LTR subtree in RTL"]'),
      ];
      const style = (el) => getComputedStyle(el);
      const px = (el, side) => parseFloat(style(el)[side]);
      const asLeft = (el) => {
        const value = style(el).backgroundPositionX.trim();
        const match = value.match(/^(-?[\\d.]+)px$/);
        return match ? parseFloat(match[1]) : null;
      };
      // Engines serialise "right 12px" either as is or as calc(100% - 12px).
      const placedRight = (el) => {
        const value = style(el).backgroundPositionX.trim();
        return /^right\\s+-?[\\d.]+px$/.test(value) ||
          /^calc\\(100% - -?[\\d.]+px\\)$/.test(value);
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
        sizeZero: box(sizeZero),
        sizeEmpty: box(sizeEmpty),
        dropdown: box(oneRow, true),
        disabled: {
          opacity: style(disabled).opacity,
          cursor: style(disabled).cursor,
          color: style(disabled).color,
        },
        disabledListBox: { cursor: style(disabledListBox).cursor },
        enabled: { opacity: style(enabled).opacity, color: style(enabled).color },
        rtl: box(rtl, true),
        ltrInRtl: ltrInRtl.map((el) => ({
          backgroundImage: style(el).backgroundImage,
          placedRight: placedRight(el),
          paddingLeft: px(el, "paddingLeft"),
          paddingRight: px(el, "paddingRight"),
        })),
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

    // size="0" is a dropdown too: the browser treats it like an absent size
    // rather than a list box, so it keeps the chevron and the reserved edge.
    expect(report.sizeZero.backgroundImage).not.toBe("none");
    expect(report.sizeZero.paddingRight).toBeGreaterThan(report.sizeZero.paddingLeft);
    expect(report.sizeZero.cursor).toBe("pointer");

    // size="" is an invalid size the same way size="0" is an invalid number of
    // rows, so it reads as an absent size — a dropdown — and not as a list box.
    expect(report.sizeEmpty.backgroundImage).not.toBe("none");
    expect(report.sizeEmpty.paddingRight).toBeGreaterThan(report.sizeEmpty.paddingLeft);
    expect(report.sizeEmpty.cursor).toBe("pointer");

    // Disabled: faded by the shared rule — the whole control, chevron
    // included — and not a usable cursor. Muting the value as well would fade
    // it twice, to roughly 1.9:1 against a disabled input's 6:1, so the shared
    // opacity is the only fade, so the two colours must match. The enabled
    // select beside it is the control — the assertions mean nothing if it is
    // faded too.
    expect(report.disabled.opacity).not.toBe(report.enabled.opacity);
    expect(report.disabled.color).toBe(report.enabled.color);
    expect(report.disabled.cursor).toBe("not-allowed");

    // A disabled list box keeps the shared cursor too. The list-box rule sets
    // its own cursor and out-specifies the :disabled rule, so without the
    // exclusion a frozen list box would still read as one you can use.
    expect(report.disabledListBox.cursor).toBe("not-allowed");

    // Right-to-left: the chevron moves to the inline-end edge (the left) and
    // the space reserved for it moves with it.
    expect(report.rtl.chevronFromLeft).not.toBeNull();
    expect(report.rtl.paddingLeft).toBe(report.dropdown.paddingRight);
    expect(report.rtl.paddingRight).toBe(report.dropdown.paddingLeft);
    expect(report.rtl.chevronFromLeft as number).toBeLessThan(report.rtl.paddingLeft);

    // A left-to-right select inside that right-to-left ancestor is back on the
    // right — whether it carries dir="ltr" itself or sits in an LTR subtree: it
    // is the select's own direction that decides, not the host's.
    for (const ltr of report.ltrInRtl) {
      expect(ltr.backgroundImage).not.toBe("none");
      expect(ltr.placedRight).toBe(true);
      expect(ltr.paddingRight).toBeGreaterThan(ltr.paddingLeft);
    }
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

  test("the primary button's white label clears AA resting and hovered", async () => {
    await view.navigate(`${BASE}/`);

    // A plain <button> takes its fill from base.css; the two .btn-primary
    // anchors (home hero, error page) take theirs from the page rules over the
    // same tokens. Built rather than found, so the assertion is about the
    // shared base styles and not about whichever page is open.
    await view.evaluate(`(() => {
      const button = document.createElement("button");
      button.type = "button";
      button.id = "smoke-primary";
      button.textContent = "Save";
      document.querySelector("main").prepend(button);
    })()`);

    const read = (): Promise<{ color: string; background: string }> =>
      view.evaluate(`(() => {
        const s = getComputedStyle(document.querySelector("#smoke-primary"));
        return { color: s.color, background: s.backgroundColor };
      })()`);

    const resting = await read();
    expect(
      contrastRatio(resting.color, resting.background),
      JSON.stringify(resting),
    ).toBeGreaterThanOrEqual(4.5);

    // A native click parks the pointer on the button, so :hover matches it —
    // but it also focuses the button, and button:focus sets the same fill, so
    // the assertion would pass with the :hover selector deleted. Blur first so
    // the read below is the hover state alone.
    await view.click("#smoke-primary");
    await view.evaluate("document.activeElement.blur()");
    await Bun.sleep(250);
    const hovered = await read();
    expect(hovered.background).not.toBe(resting.background);
    expect(
      contrastRatio(hovered.color, hovered.background),
      JSON.stringify(hovered),
    ).toBeGreaterThanOrEqual(4.5);

    await view.evaluate(`document.querySelector("#smoke-primary")?.remove()`);
  });

  test("disabled controls look disabled", async () => {
    await view.navigate(`${BASE}/forms`);

    // A disabled input normally keeps its box, and a restyled select or button
    // keeps its fill, in both Chromium and WebKit — so "disabled" has to be
    // drawn. The enabled button is the control: the fade means nothing if it
    // is faded too.
    const report = await view.evaluate<{
      disabled: Record<
        "input" | "select" | "button",
        { opacity: string; cursor: string }
      >;
      enabled: { opacity: string; cursor: string };
    }>(`(() => {
      const wrap = document.createElement("div");
      wrap.innerHTML =
        '<input id="smoke-d-input" disabled aria-label="Disabled input">' +
        '<select id="smoke-d-select" disabled aria-label="Disabled select"><option>Member</option></select>' +
        '<button id="smoke-d-button" type="button" disabled>Save</button>' +
        '<button id="smoke-e-button" type="button">Send</button>';
      document.querySelector("main").prepend(wrap);
      const read = (id) => {
        const s = getComputedStyle(document.getElementById(id));
        return { opacity: s.opacity, cursor: s.cursor };
      };
      const result = {
        disabled: {
          input: read("smoke-d-input"),
          select: read("smoke-d-select"),
          button: read("smoke-d-button"),
        },
        enabled: read("smoke-e-button"),
      };
      wrap.remove();
      return result;
    })()`);

    for (const box of Object.values(report.disabled)) {
      expect(box.opacity, JSON.stringify(box)).toBe("0.5");
    }
    expect(report.enabled.opacity).toBe("1");
    expect(report.disabled.input.cursor).toBe("not-allowed");
    expect(report.disabled.select.cursor).toBe("not-allowed");
    expect(report.disabled.button.cursor).toBe("not-allowed");
    expect(report.enabled.cursor).toBe("pointer");
  });

  test("a disabled button keeps its resting fill while hovered", async () => {
    await view.navigate(`${BASE}/forms`);

    // :hover matches a disabled button — the engine doesn't consult the
    // attribute for it — so the fill rules exclude :disabled rather than
    // leaning on the shared fade: a frozen control stays at its resting fill
    // under the pointer. The enabled twins are the proof hover reached the
    // page: "the disabled one didn't change" means nothing if nothing changed.
    //
    // A click at (1, 1) parks the pointer on the header's inert corner first —
    // the previous test left it wherever it hovered last, and every resting
    // read below would otherwise be a hovered one.
    await view.click(1, 1);
    await Bun.sleep(250);

    const resting = await view.evaluate<
      Record<string, { x: number; y: number; background: string }>
    >(`(() => {
      const row = document.createElement("div");
      row.id = "smoke-hover-row";
      row.style.display = "flex";
      row.style.gap = "8px";
      row.innerHTML =
        '<button id="smoke-h-primary" type="button">Save</button>' +
        '<button id="smoke-h-primary-disabled" type="button" disabled>Save</button>' +
        '<button id="smoke-h-ghost" type="button" class="btn-ghost">Cancel</button>' +
        '<button id="smoke-h-ghost-disabled" type="button" class="btn-ghost" disabled>Cancel</button>';
      document.querySelector("main").prepend(row);
      const read = (id) => {
        const el = document.getElementById(id);
        const box = el.getBoundingClientRect();
        return {
          x: box.left + box.width / 2,
          y: box.top + box.height / 2,
          background: getComputedStyle(el).backgroundColor,
        };
      };
      return {
        primary: read("smoke-h-primary"),
        primaryDisabled: read("smoke-h-primary-disabled"),
        ghost: read("smoke-h-ghost"),
        ghostDisabled: read("smoke-h-ghost-disabled"),
      };
    })()`);

    const background = (id: string): Promise<string> =>
      view.evaluate<string>(
        `getComputedStyle(document.getElementById("${id}")).backgroundColor`,
      );

    // A native click parks the pointer on the disabled controls, which is how
    // :hover comes to match them at all.
    await view.click(resting.primaryDisabled.x, resting.primaryDisabled.y);
    await Bun.sleep(250);
    expect(await background("smoke-h-primary-disabled")).toBe(
      resting.primaryDisabled.background,
    );

    await view.click(resting.ghostDisabled.x, resting.ghostDisabled.y);
    await Bun.sleep(250);
    expect(await background("smoke-h-ghost-disabled")).toBe(
      resting.ghostDisabled.background,
    );

    // The same click on an enabled control changes its fill, so hover really
    // applied to this page in this engine.
    await view.click(resting.primary.x, resting.primary.y);
    await Bun.sleep(250);
    expect(await background("smoke-h-primary")).not.toBe(
      resting.primary.background,
    );

    await view.click(resting.ghost.x, resting.ghost.y);
    await Bun.sleep(250);
    expect(await background("smoke-h-ghost")).not.toBe(
      resting.ghost.background,
    );

    await view.evaluate(
      `document.getElementById("smoke-hover-row")?.remove()`,
    );
  });

  test("a page's own button state survives the shared hover fill", async () => {
    await view.navigate(`${BASE}/todos`);

    // base.css sets the filled button's hover fill as a (0,1,1) default —
    // :where() keeps it there. A page rule at class specificity still has to
    // win on hover: the todos .toggle-btn draws a transparent circle and the
    // /team danger button its own tint, so neither may take the indigo fill
    // under the pointer. Scoping the state to the plain element instead would
    // out-specify both. The plain primary button is the control — its hover
    // fill is exactly the one the other two must not take.
    //
    // A click at (1, 1) parks the pointer on the header's inert corner first,
    // so every resting read below is a resting one.
    await view.click(1, 1);
    await Bun.sleep(250);

    const resting = await view.evaluate<
      Record<
        "primary" | "danger" | "toggle",
        { x: number; y: number; background: string; color: string }
      >
    >(`(() => {
      const row = document.createElement("div");
      row.id = "smoke-state-row";
      row.style.display = "flex";
      row.style.gap = "8px";
      row.innerHTML =
        '<button id="smoke-s-primary" type="button">Save</button>' +
        '<button id="smoke-s-danger" type="button" class="btn-danger">Remove</button>' +
        '<button id="smoke-s-toggle" type="button" class="toggle-btn" aria-pressed="false">Done</button>';
      document.querySelector("main").prepend(row);
      const read = (id) => {
        const el = document.getElementById(id);
        const box = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return {
          x: box.left + box.width / 2,
          y: box.top + box.height / 2,
          background: style.backgroundColor,
          color: style.color,
        };
      };
      return {
        primary: read("smoke-s-primary"),
        danger: read("smoke-s-danger"),
        toggle: read("smoke-s-toggle"),
      };
    })()`);

    const read = (id: string): Promise<{ background: string; color: string }> =>
      view.evaluate(`(() => {
        const style = getComputedStyle(document.getElementById("${id}"));
        return { background: style.backgroundColor, color: style.color };
      })()`);

    // Hover the toggle: it stays the transparent circle its own rule draws,
    // and the colour step that rule does carry still happens — so the
    // background assertion is not passing because hover never reached it.
    await view.click(resting.toggle.x, resting.toggle.y);
    await Bun.sleep(250);
    const toggle = await read("smoke-s-toggle");
    expect(toggle.background).toBe(resting.toggle.background);
    expect(toggle.color).not.toBe(resting.toggle.color);

    // Hover the danger button: it takes its own tint, not the shared fill.
    await view.click(resting.danger.x, resting.danger.y);
    await Bun.sleep(250);
    const danger = await read("smoke-s-danger");
    expect(danger.background).not.toBe(resting.danger.background);

    // The control: a plain primary button does take the shared hover fill.
    await view.click(resting.primary.x, resting.primary.y);
    await Bun.sleep(250);
    const primary = await read("smoke-s-primary");
    expect(primary.background).not.toBe(resting.primary.background);

    // The regression this guards: the page rules failed to out-specify the
    // shared fill, so both took the control's indigo.
    expect(danger.background).not.toBe(primary.background);
    expect(toggle.background).not.toBe(primary.background);

    await view.evaluate(
      `document.getElementById("smoke-state-row")?.remove()`,
    );
  });

  test("a field's border and placeholder clear their contrast floors", async () => {
    await view.navigate(`${BASE}/forms`);

    const report = await view.evaluate<{
      border: string;
      placeholder: string;
      background: string;
    }>(`(() => {
      const input = document.createElement("input");
      input.setAttribute("aria-label", "Field");
      input.placeholder = "you@example.com";
      document.querySelector("main").prepend(input);
      const result = {
        border: getComputedStyle(input).borderTopColor,
        placeholder: getComputedStyle(input, "::placeholder").color,
        background: getComputedStyle(input).backgroundColor,
      };
      input.remove();
      return result;
    })()`);

    // WCAG 1.4.11: the boundary that identifies a field needs 3:1.
    expect(
      contrastRatio(report.border, report.background),
      JSON.stringify(report),
    ).toBeGreaterThanOrEqual(3);
    // The placeholder is text, so it needs 4.5:1.
    expect(
      contrastRatio(report.placeholder, report.background),
      JSON.stringify(report),
    ).toBeGreaterThanOrEqual(4.5);
  });

  test("the site footer and login-footer links clear AA", async () => {
    // The two muted links the review called out. Reads them at rest; /login is
    // signed-out chrome, so this runs before the magic link signs in.
    // Navigated to explicitly rather than inheriting whatever page the previous
    // test left, which is how this used to read a footer that might not exist.
    await view.navigate(`${BASE}/`);

    const site = await view.evaluate<{ link: string; background: string }>(
      `(() => {
        const footer = document.querySelector('[data-component="layout"] > footer');
        return {
          link: getComputedStyle(footer.querySelector("a")).color,
          background: getComputedStyle(document.body).backgroundColor,
        };
      })()`,
    );
    expect(
      contrastRatio(site.link, site.background),
      JSON.stringify(site),
    ).toBeGreaterThanOrEqual(4.5);

    await view.navigate(`${BASE}/login`);
    const login = await view.evaluate<{ link: string; background: string }>(
      `(() => {
        const footer = document.querySelector(".login-footer");
        return {
          link: getComputedStyle(footer.querySelector("a")).color,
          background: getComputedStyle(document.querySelector(".login-page")).backgroundColor,
        };
      })()`,
    );
    expect(
      contrastRatio(login.link, login.background),
      JSON.stringify(login),
    ).toBeGreaterThanOrEqual(4.5);
  });

  test("the error page's nav is one row on a phone", async () => {
    // The 404 ships no client JavaScript by design, so there is no hamburger;
    // the fallback layout has to fit the pages and the single Login on one row.
    await view.navigate(`${BASE}/this-page-does-not-exist`);
    await view.resize(390, 844);

    const report = await view.evaluate<{
      linkCentre: number;
      authCentre: number;
      scrollWidth: number;
      clientWidth: number;
    }>(`(() => {
      const nav = document.querySelector('[data-component="nav"]');
      const link = nav.querySelector("ul a").getBoundingClientRect();
      const auth = nav.querySelector(".nav-auth a").getBoundingClientRect();
      return {
        linkCentre: link.top + link.height / 2,
        authCentre: auth.top + auth.height / 2,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    })()`);

    // align-items: center makes one row's centres equal; a second row would
    // separate them by most of its height.
    expect(
      Math.abs(report.linkCentre - report.authCentre),
      JSON.stringify(report),
    ).toBeLessThanOrEqual(6);
    expect(report.scrollWidth).toBeLessThanOrEqual(report.clientWidth);
    await view.resize(1280, 900);
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
    const readNav = (): Promise<{
      anchor: NavBox;
      button: NavBox;
      page: NavBox;
    }> =>
      view.evaluate(`(() => {
        const nav = document.querySelector('[data-component="nav"]');
        const auth = nav.querySelector(".nav-auth");
        const anchor = auth.querySelector("a.btn-ghost");
        const button = auth.querySelector("button.btn-ghost");
        const page = nav.querySelector("ul a");
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
        return { anchor: box(anchor), button: box(button), page: box(page) };
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
    // And the page links are rows of the same height as the auth actions. A
    // page link inherits the body's line-height unless the panel's shared rule
    // sets the control one, so it used to measure ~42.4px beside the 44px
    // Account/Logout rows.
    expect(panel.page.height).toBe(panel.anchor.height);

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

  test("the /todos endpoint table fits its card from 360px up, and 320px scrolls it", async () => {
    // The endpoint table's monospace path cells can't shrink past their
    // content, so three columns used to push the whole document sideways on a
    // phone. The card scrolls inside itself now, and the phone padding is
    // tightened so it only has to below 360px. The card is a labelled,
    // focusable region, so the remainder is reachable without a pointer. Same
    // layout-viewport measurement as the /team check above.
    await view.navigate(`${BASE}/todos`);

    const region = await view.evaluate<{
      tag: string;
      label: string | null;
      tabindex: string | null;
      focusable: boolean;
    }>(`(() => {
      const card = document.querySelector('.api-section .card');
      card.focus();
      return {
        tag: card.tagName.toLowerCase(),
        label: card.getAttribute('aria-label'),
        tabindex: card.getAttribute('tabindex'),
        focusable: document.activeElement === card,
      };
    })()`);
    // A name on a <section> makes it a `region` landmark; tabindex makes it
    // reachable, so the keyboard can scroll the remainder.
    expect(region.tag).toBe("section");
    expect(region.label).toBe("API endpoints");
    expect(region.tabindex).toBe("0");
    expect(region.focusable).toBe(true);

    const layout = () =>
      view.evaluate<{
        docScroll: number;
        docClient: number;
        inner: number;
        cardScroll: number;
        cardClient: number;
      }>(`(() => {
        const card = document.querySelector('.api-section .card');
        return {
          docScroll: document.documentElement.scrollWidth,
          docClient: document.documentElement.clientWidth,
          inner: window.innerWidth,
          cardScroll: card.scrollWidth,
          cardClient: card.clientWidth,
        };
      })()`);

    // 390 and 360: the table fits the card, so nothing scrolls sideways.
    for (const width of [390, 360]) {
      await view.resize(width, 844);
      const box = await until(layout, (value) => value.inner === width);
      expect(box.docScroll, `document at ${width}px`).toBeLessThanOrEqual(
        box.docClient,
      );
      expect(box.cardScroll, `card at ${width}px`).toBeLessThanOrEqual(
        box.cardClient,
      );
    }

    // Screenshots for the record, with the table in view.
    const { mkdirSync } = await import("node:fs");
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await view.scrollTo(".api-section .card", { block: "center" });
    await Bun.write(
      `${SCREENSHOT_DIR}/todos-endpoint-360.png`,
      await view.screenshot(),
    );

    // 320: the card carries the last sliver of scroll, not the document.
    await view.resize(320, 844);
    const narrow = await until(layout, (value) => value.inner === 320);
    expect(narrow.docScroll).toBeLessThanOrEqual(narrow.docClient);
    expect(narrow.cardScroll).toBeGreaterThan(narrow.cardClient);
    await view.scrollTo(".api-section .card", { block: "center" });
    await Bun.write(
      `${SCREENSHOT_DIR}/todos-endpoint-320.png`,
      await view.screenshot(),
    );
    await view.resize(1280, 900);
  });

  test("the sticky verify banner clears the header, reserves scroll padding, and shortens on a phone", async () => {
    // Signed in with an unverified address and JavaScript off, the banner
    // wraps at 320px. It used to be `position: fixed` with a 72px body offset
    // shorter than the wrapped bar, so it covered the header's page links;
    // sticky keeps it in flow, so the header is always below it. Any
    // scroll-into-view — Tab focus or the #verify-email jump — still lands the
    // target under the bar, so html reserves scroll-padding-top while it
    // shows. On a phone the bar is also tightened (gap and line-height) so it
    // takes less of the screen. The banner is built in the page rather than
    // found on one (the magic-link sign-in above stamps email_verified_at, so
    // a real one cannot appear here); the CSS under test is the same rules the
    // server renders into.
    await view.navigate(`${BASE}/`);
    await view.resize(320, 844);

    const report = await until(
      () =>
        view.evaluate<{
          bannerBottom: number;
          bannerHeight: number;
          linkTop: number;
          linkBottom: number;
          position: string;
          scrollPad: string;
          lineHeight: string;
          rowGap: string;
          scroll: number;
          client: number;
        }>(`(() => {
          if (!document.querySelector(".verify-banner")) {
            document.body.insertAdjacentHTML("afterbegin",
              '<div class="verify-banner"><span>Confirm your email address to secure your account.</span><a href="#">Resend the link</a></div>');
          }
          const nav = document.querySelector('[data-component="nav"]');
          nav.removeAttribute("data-nav-enhanced");
          nav.querySelector(".nav-toggle")?.setAttribute("hidden", "");
          const banner = document.querySelector(".verify-banner");
          const style = getComputedStyle(banner);
          const box = banner.getBoundingClientRect();
          const link = nav.querySelector("ul a").getBoundingClientRect();
          return {
            bannerBottom: box.bottom,
            bannerHeight: box.height,
            linkTop: link.top,
            linkBottom: link.bottom,
            position: style.position,
            scrollPad: getComputedStyle(document.documentElement).scrollPaddingTop,
            lineHeight: style.lineHeight,
            rowGap: style.rowGap,
            scroll: document.documentElement.scrollWidth,
            client: document.documentElement.clientWidth,
          };
        })()`),
      (value) => value.position === "sticky" && value.linkTop >= value.bannerBottom,
    );

    expect(report.position).toBe("sticky");
    // The page link sits entirely below the banner rather than under it.
    expect(report.linkTop).toBeGreaterThanOrEqual(report.bannerBottom);
    expect(report.linkBottom).toBeLessThanOrEqual(844);
    expect(report.scroll).toBeLessThanOrEqual(report.client);

    // A focus or fragment jump scrolls its target to the top of the scrollport
    // — under the bar. scroll-padding-top reserves the bar's height while it
    // renders; 6.75rem is the phone value.
    expect(report.scrollPad).toBe("108px");

    // The phone bar is shortened with a tighter row gap and line-height rather
    // than less copy.
    expect(report.lineHeight).toBe("19.6px");
    expect(report.rowGap).toBe("4px");
    expect(report.bannerHeight).toBeLessThan(90);

    const { mkdirSync } = await import("node:fs");
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await Bun.write(
      `${SCREENSHOT_DIR}/verify-banner-320.png`,
      await view.screenshot(),
    );
    await view.resize(360, 844);
    await Bun.sleep(150);
    await Bun.write(
      `${SCREENSHOT_DIR}/verify-banner-360.png`,
      await view.screenshot(),
    );

    // With the bar gone the reserved strip goes with it.
    await view.evaluate(`document.querySelector(".verify-banner")?.remove()`);
    const cleared = await view.evaluate<string>(
      `getComputedStyle(document.documentElement).scrollPaddingTop`,
    );
    expect(cleared).toBe("auto");

    await view.resize(1280, 900);
  });

  test("no page threw or hit a CSP violation across the run", () => {
    expect(pageErrors).toEqual([]);
  });
});
