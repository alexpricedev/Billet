import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { link, linksSupported, log, prettyLogs } from "./logger";

describe("log", () => {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  let logCalls: string[];
  let warnCalls: string[];
  let errorCalls: string[];

  beforeEach(() => {
    logCalls = [];
    warnCalls = [];
    errorCalls = [];
    console.log = (...args: unknown[]) => logCalls.push(args.join(" "));
    console.warn = (...args: unknown[]) => warnCalls.push(args.join(" "));
    console.error = (...args: unknown[]) => errorCalls.push(args.join(" "));
  });

  afterEach(() => {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  });

  test("info writes to stdout with formatted prefix", () => {
    log.info("server", "Listening on :3000");
    expect(logCalls).toHaveLength(1);
    expect(logCalls[0]).toBe("[INFO] [server] Listening on :3000");
  });

  test("warn writes to stderr with formatted prefix", () => {
    log.warn("auth", "Token expiring soon");
    expect(warnCalls).toHaveLength(1);
    expect(warnCalls[0]).toBe("[WARN] [auth] Token expiring soon");
  });

  test("error writes to stderr with formatted prefix", () => {
    log.error("database", "Connection failed");
    expect(errorCalls).toHaveLength(1);
    expect(errorCalls[0]).toBe("[ERROR] [database] Connection failed");
  });
});

// Every signal the format reads is ambient, so each case pins all of them.
const FORMAT_KEYS = ["LOG_FORMAT", "TERM", "CI", "NO_COLOR", "NODE_ENV"];

const withEnv = (env: Record<string, string>, run: () => void): void => {
  const saved = FORMAT_KEYS.map((key) => [key, process.env[key]] as const);
  const isTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  for (const key of FORMAT_KEYS) delete process.env[key];
  Object.assign(process.env, env);
  Object.defineProperty(process.stdout, "isTTY", {
    value: false,
    configurable: true,
  });

  try {
    run();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    if (isTTY) {
      Object.defineProperty(process.stdout, "isTTY", isTTY);
    } else {
      delete (process.stdout as { isTTY?: boolean }).isTTY;
    }
  }
};

describe("prettyLogs", () => {
  const TERMINAL = { TERM: "xterm-256color" };

  test.each([
    ["a terminal is reading", TERMINAL, true],
    ["nothing says a terminal is reading", {}, false],
    ["the terminal is dumb", { TERM: "dumb" }, false],
    ["the output is captured in CI", { ...TERMINAL, CI: "true" }, false],
    ["in production", { ...TERMINAL, NODE_ENV: "production" }, false],
    [
      "LOG_FORMAT=plain on a terminal",
      { ...TERMINAL, LOG_FORMAT: "plain" },
      false,
    ],
    ["LOG_FORMAT=pretty with no terminal", { LOG_FORMAT: "pretty" }, true],
    [
      "LOG_FORMAT=pretty in production",
      { LOG_FORMAT: "pretty", NODE_ENV: "production" },
      true,
    ],
    // Cosmetic, so a typo falls back to deciding for itself rather than
    // stopping the boot.
    [
      "a value it doesn't know, on a terminal",
      { ...TERMINAL, LOG_FORMAT: "json" },
      true,
    ],
    [
      "a value it doesn't know, with no terminal",
      { LOG_FORMAT: "json" },
      false,
    ],
  ] as [string, Record<string, string>, boolean][])(
    "%s",
    (_, env, expected) => {
      withEnv(env, () => expect(prettyLogs()).toBe(expected));
    },
  );
});

describe("pretty log lines", () => {
  const originals = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };
  let out: string[];
  let err: string[];

  beforeEach(() => {
    out = [];
    err = [];
    console.log = (...args: unknown[]) => out.push(args.join(" "));
    console.warn = (...args: unknown[]) => err.push(args.join(" "));
    console.error = (...args: unknown[]) => err.push(args.join(" "));
  });

  afterEach(() => {
    console.log = originals.log;
    console.warn = originals.warn;
    console.error = originals.error;
  });

  const PRETTY = { LOG_FORMAT: "pretty", NO_COLOR: "1" };

  test("info drops the level and the brackets", () => {
    withEnv(PRETTY, () => log.info("server", "Listening"));
    expect(out).toEqual(["server  Listening"]);
  });

  test("warn and error keep a level word, and still go to stderr", () => {
    withEnv(PRETTY, () => {
      log.warn("assets", "bundle missing");
      log.error("env", "PORT is required");
    });
    expect(out).toEqual([]);
    expect(err).toEqual([
      "warn assets  bundle missing",
      "error env  PORT is required",
    ]);
  });

  test("colour dims the category and marks the level", () => {
    withEnv({ LOG_FORMAT: "pretty" }, () => {
      log.info("server", "Listening");
      log.warn("assets", "bundle missing");
    });
    expect(out).toEqual(["\u001b[2mserver\u001b[22m  Listening"]);
    expect(err).toEqual([
      "\u001b[33mwarn\u001b[39m \u001b[2massets\u001b[22m  bundle missing",
    ]);
  });

  test("detail is an info line in plain and nothing in pretty", () => {
    withEnv({ LOG_FORMAT: "plain" }, () => log.detail("env", "validated"));
    withEnv(PRETTY, () => log.detail("env", "validated"));
    expect(out).toEqual(["[INFO] [env] validated"]);
  });

  test("line prints its text untouched in either format", () => {
    withEnv({ LOG_FORMAT: "plain" }, () => log.line("  Billet  :3000"));
    withEnv(PRETTY, () => log.line("  Billet  :3000"));
    expect(out).toEqual(["  Billet  :3000", "  Billet  :3000"]);
  });
});

describe("linksSupported", () => {
  test("is what link() decides on", () => {
    withEnv({ TERM: "xterm-256color" }, () => {
      expect(linksSupported()).toBe(true);
      expect(link("http://x", "x")).not.toBe("x");
    });
    withEnv({ TERM: "xterm-256color", NO_COLOR: "1" }, () => {
      expect(linksSupported()).toBe(false);
      expect(link("http://x", "x")).toBe("x");
    });
  });
});

describe("link", () => {
  const URL = "http://localhost:3000";
  const WRAPPED = `\u001b]8;;${URL}\u001b\\${URL}\u001b]8;;\u001b\\`;

  // Both signals link() reads are ambient — the developer's TERM, whatever CI
  // sets, the stream's TTY-ness — so every case pins them rather than trusting
  // the machine the suite happens to run on.
  const ENV_KEYS = ["TERM", "CI", "NO_COLOR", "NO_HYPERLINK"] as const;
  const originalEnv = new Map<string, string | undefined>();
  const originalIsTTY = Object.getOwnPropertyDescriptor(
    process.stdout,
    "isTTY",
  );

  const setTTY = (isTTY: boolean): void => {
    Object.defineProperty(process.stdout, "isTTY", {
      value: isTTY,
      configurable: true,
    });
  };

  const clearEnv = (): void => {
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }
  };

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      originalEnv.set(key, process.env[key]);
    }
    clearEnv();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = originalEnv.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    if (originalIsTTY) {
      Object.defineProperty(process.stdout, "isTTY", originalIsTTY);
    } else {
      delete (process.stdout as { isTTY?: boolean }).isTTY;
    }
  });

  test("wraps the URL as an OSC 8 hyperlink on a terminal", () => {
    process.env.TERM = "xterm-256color";
    setTTY(true);
    expect(link(URL)).toBe(WRAPPED);
  });

  test("still links when stdout is a pipe but TERM says terminal", () => {
    // What `bun run dev` does to the server's stdout: prefixed output, no TTY.
    process.env.TERM = "xterm-256color";
    setTTY(false);
    expect(link(URL)).toBe(WRAPPED);
  });

  test("falls back to bare text with no TERM to go on", () => {
    setTTY(false);
    expect(link(URL)).toBe(URL);
  });

  test("falls back to bare text on a dumb terminal", () => {
    process.env.TERM = "dumb";
    expect(link(URL)).toBe(URL);
  });

  test("falls back to bare text when the build is captured in CI", () => {
    process.env.TERM = "xterm-256color";
    process.env.CI = "true";
    expect(link(URL)).toBe(URL);
  });

  test("honours NO_COLOR and NO_HYPERLINK as opt-outs", () => {
    process.env.TERM = "xterm-256color";
    process.env.NO_COLOR = "1";
    expect(link(URL)).toBe(URL);

    delete process.env.NO_COLOR;
    process.env.NO_HYPERLINK = "1";
    expect(link(URL)).toBe(URL);
  });

  test("uses the label as the visible text when given one", () => {
    process.env.TERM = "xterm-256color";
    expect(link(URL, "port 3000")).toBe(
      `\u001b]8;;${URL}\u001b\\port 3000\u001b]8;;\u001b\\`,
    );
  });
});
