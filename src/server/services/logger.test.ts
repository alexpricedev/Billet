import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { log } from "./logger";

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
