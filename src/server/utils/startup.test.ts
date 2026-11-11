import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { devLoginUrl } from "../services/dev-login";
import { startupLines } from "./startup";

// link() reads the terminal for itself, so the cases that want real links pin
// one and the rest pin its absence.
const KEYS = ["DEV_LOGIN", "TERM", "CI", "NO_COLOR", "NO_HYPERLINK"] as const;
const original = new Map<string, string | undefined>();

const osc8 = (url: string, text: string): string =>
  `\u001b]8;;${url}\u001b\\${text}\u001b]8;;\u001b\\`;

// What is left on screen once a terminal has consumed the link escapes.
const ESC = String.fromCharCode(27);
const LINK_ESCAPE = new RegExp(`${ESC}\\]8;;[^${ESC}]*${ESC}\\\\`, "g");
const COLOUR_ESCAPE = new RegExp(`${ESC}\\[[0-9;]*m`, "g");
const visible = (line: string): string =>
  line.replace(LINK_ESCAPE, "").replace(COLOUR_ESCAPE, "");

const PORT = 55300;

const AT = new Date(2026, 10, 11, 9, 5, 7);
// Dimmed, because nothing here sets NO_COLOR.
const RULE = "\u001b[2m── 09:05:07 ────────────\u001b[22m";
const URL = `http://localhost:${PORT}`;

beforeEach(() => {
  for (const key of KEYS) {
    original.set(key, process.env[key]);
    delete process.env[key];
  }
  process.env.DEV_LOGIN = "true";
});

afterEach(() => {
  for (const key of KEYS) {
    const value = original.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("plain", () => {
  test("one message per fact, every URL spelled out", () => {
    expect(startupLines({ port: PORT, pretty: false, links: false })).toEqual([
      `Listening on ${URL}`,
      `Sign in as admin@example.com (admin): ${devLoginUrl(PORT, "admin")}`,
      `Sign in as alice@example.com (user): ${devLoginUrl(PORT, "user")}`,
    ]);
  });

  test("only the listen line when dev sign-in is off", () => {
    process.env.DEV_LOGIN = "false";

    expect(startupLines({ port: PORT, pretty: false, links: false })).toEqual([
      `Listening on ${URL}`,
    ]);
  });
});

describe("pretty, where links render", () => {
  beforeEach(() => {
    process.env.TERM = "xterm-256color";
  });

  const lines = () =>
    startupLines({ port: PORT, pretty: true, links: true, at: AT });

  test("the account names are the links", () => {
    expect(lines()).toEqual([
      "",
      RULE,
      `Server   ${osc8(URL, "localhost:55300")}`,
      `Sign in  ${osc8(devLoginUrl(PORT, "admin"), "admin")} · ${osc8(devLoginUrl(PORT, "user"), "user")}`,
    ]);
  });

  // The point of the block: `bun run dev` prefixes every line with
  // `dev:server | ` (13 columns) and the panel it runs in is about 40 wide.
  test("fits beside the dev:server prefix in a 40-column panel", () => {
    for (const line of lines()) {
      expect(visible(line).length).toBeLessThanOrEqual(40 - 13);
    }
  });

  test("no sign-in row when dev sign-in is off", () => {
    process.env.DEV_LOGIN = "false";

    expect(lines()).toEqual([
      "",
      RULE,
      `Server   ${osc8(URL, "localhost:55300")}`,
    ]);
  });
});

describe("the rule above the block", () => {
  // `bun --watch` prints the block again on every save; the time is what
  // tells one start from the next.
  test("carries the start time and no escapes under NO_COLOR", () => {
    process.env.NO_COLOR = "1";

    const [, rule] = startupLines({
      port: PORT,
      pretty: true,
      links: false,
      at: new Date(2026, 10, 11, 23, 59, 0),
    });

    expect(rule).toBe("── 23:59:00 ────────────");
  });

  test("plain output has none", () => {
    const lines = startupLines({ port: PORT, pretty: false, links: false });

    expect(lines.join("\n")).not.toContain("──");
  });
});

describe("pretty, where links don't render", () => {
  // A name that can't be clicked would hide the only way in.
  test("the sign-in URLs are printed in full", () => {
    expect(
      startupLines({ port: PORT, pretty: true, links: false, at: AT }),
    ).toEqual([
      "",
      RULE,
      `Server   ${URL}`,
      "Sign in as admin",
      devLoginUrl(PORT, "admin"),
      "Sign in as user",
      devLoginUrl(PORT, "user"),
    ]);
  });
});
