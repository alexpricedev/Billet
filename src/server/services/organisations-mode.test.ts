import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  isOrganisationsFlag,
  organisationsEnabled,
} from "./organisations-mode";

const original = process.env.ORGANISATIONS_ENABLED;

beforeEach(() => {
  delete process.env.ORGANISATIONS_ENABLED;
});

afterEach(() => {
  if (original === undefined) {
    delete process.env.ORGANISATIONS_ENABLED;
  } else {
    process.env.ORGANISATIONS_ENABLED = original;
  }
});

describe("organisationsEnabled", () => {
  test("defaults to off when unset", () => {
    expect(organisationsEnabled()).toBe(false);
  });

  test("is on when set to true", () => {
    process.env.ORGANISATIONS_ENABLED = "true";
    expect(organisationsEnabled()).toBe(true);
  });

  test("is off when set to false", () => {
    process.env.ORGANISATIONS_ENABLED = "false";
    expect(organisationsEnabled()).toBe(false);
  });

  test("reads the env on every call so a change takes effect", () => {
    expect(organisationsEnabled()).toBe(false);
    process.env.ORGANISATIONS_ENABLED = "true";
    expect(organisationsEnabled()).toBe(true);
    delete process.env.ORGANISATIONS_ENABLED;
    expect(organisationsEnabled()).toBe(false);
  });
});

describe("isOrganisationsFlag", () => {
  test("accepts the two supported values", () => {
    expect(isOrganisationsFlag("true")).toBe(true);
    expect(isOrganisationsFlag("false")).toBe(true);
  });

  test("rejects anything else, including near-misses validateEnv must catch", () => {
    // Each of these would read as off, which is the wrong kind of quiet: the
    // operator asked for organisations and the app would serve without them.
    expect(isOrganisationsFlag("yes")).toBe(false);
    expect(isOrganisationsFlag("1")).toBe(false);
    expect(isOrganisationsFlag("True")).toBe(false);
    expect(isOrganisationsFlag("")).toBe(false);
    expect(isOrganisationsFlag(undefined)).toBe(false);
  });
});
