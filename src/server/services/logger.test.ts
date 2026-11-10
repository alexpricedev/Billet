import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { link, log } from "./logger";

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
