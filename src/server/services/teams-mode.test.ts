import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { isTeamsFlagValue, teamsEnabled } from "./teams-mode";

const original = process.env.TEAMS_ENABLED;

beforeEach(() => {
  delete process.env.TEAMS_ENABLED;
});

afterEach(() => {
  if (original === undefined) {
    delete process.env.TEAMS_ENABLED;
  } else {
    process.env.TEAMS_ENABLED = original;
  }
});

describe("teamsEnabled", () => {
  test("defaults to off when unset", () => {
    expect(teamsEnabled()).toBe(false);
  });

  test("is on only for the exact string true", () => {
    process.env.TEAMS_ENABLED = "true";
    expect(teamsEnabled()).toBe(true);
  });

  test("is off when set explicitly to false", () => {
    process.env.TEAMS_ENABLED = "false";
    expect(teamsEnabled()).toBe(false);
  });

  test("reads the env on every call so a change takes effect", () => {
    expect(teamsEnabled()).toBe(false);
    process.env.TEAMS_ENABLED = "true";
    expect(teamsEnabled()).toBe(true);
    delete process.env.TEAMS_ENABLED;
    expect(teamsEnabled()).toBe(false);
  });
});

describe("isTeamsFlagValue", () => {
  test("accepts the two supported values", () => {
    expect(isTeamsFlagValue("true")).toBe(true);
    expect(isTeamsFlagValue("false")).toBe(true);
  });

  test("rejects the near-misses validateEnv must catch", () => {
    expect(isTeamsFlagValue("1")).toBe(false);
    expect(isTeamsFlagValue("yes")).toBe(false);
    expect(isTeamsFlagValue("TRUE")).toBe(false);
    expect(isTeamsFlagValue("")).toBe(false);
    expect(isTeamsFlagValue(undefined)).toBe(false);
  });
});
