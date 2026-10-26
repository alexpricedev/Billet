import { describe, expect, test } from "bun:test";
import { safeNextPath, withNext } from "./next-path";

describe("safeNextPath", () => {
  // Every case is labelled, because the interesting inputs are unprintable or
  // would read as noise in a test name.
  const accepted: Array<[string, unknown, string]> = [
    ["a plain path", "/cms/sign-in", "/cms/sign-in"],
    ["a path with a query", "/cms/sign-in?x=1&y=2", "/cms/sign-in?x=1&y=2"],
    ["the root", "/", "/"],
    ["a fragment", "/cms/sign-in#intro", "/cms/sign-in#intro"],
    ["surrounding whitespace", " /cms/sign-in ", "/cms/sign-in"],
    ["dot segments, normalised", "/a/../cms/sign-in", "/cms/sign-in"],
    [
      "a percent-encoded space, left encoded",
      "/cms%20sign-in",
      "/cms%20sign-in",
    ],
    [
      "percent-encoded, left encoded",
      "/cms/sign-in%3Fnot-a-query",
      "/cms/sign-in%3Fnot-a-query",
    ],
  ];

  for (const [label, input, expected] of accepted) {
    test(`accepts ${label}`, () => {
      expect(safeNextPath(input)).toBe(expected);
    });
  }

  const refused: Array<[string, unknown]> = [
    ["nothing", undefined],
    ["null", null],
    ["an empty string", ""],
    ["blank space", "   "],
    ["a number", 42],
    ["an object", { next: "/" }],
    ["a path without a leading slash", "cms/sign-in"],
    ["a protocol-relative URL", "//evil.example"],
    ["an absolute URL", "https://evil.example"],
    ["a http URL", "http://evil.example"],
    ["a javascript URL", "javascript:alert(1)"],
    ["a data URL", "data:text/html,<script>alert(1)</script>"],
    ["a backslash before a host", "/\\evil.example"],
    ["two backslashes", "\\\\evil.example"],
    ["a backslash deeper in the path", "/cms/\\evil.example"],
    ["a raw CRLF", "/cms/sign-in\r\nLocation: https://evil.example"],
    ["a raw NUL", "/cms/sign-in\u0000"],
    ["a space inside", "/cms sign-in"],
    ["over the length cap", `/${"a".repeat(1000)}`],
    ["the login page", "/login"],
    ["the login page with a query", "/login?next=/x"],
    ["the login page with a fragment", "/login#frag"],
    ["the signup page", "/signup?x=1"],
    ["the forgot-password page", "/forgot-password"],
    ["the reset-password page", "/reset-password?token=x"],
  ];

  for (const [label, input] of refused) {
    test(`refuses ${label}`, () => {
      expect(safeNextPath(input)).toBeNull();
    });
  }

  // A path that merely starts with a guest page's name is not that page:
  // "/loginfo" is a different route and has no loop behind it.
  test("does not refuse a path that only shares a guest page's prefix", () => {
    expect(safeNextPath("/loginfo")).toBe("/loginfo");
    expect(safeNextPath("/signup-confirmation")).toBe("/signup-confirmation");
  });
});

describe("withNext", () => {
  test("returns the href unchanged without a destination", () => {
    expect(withNext("/login", null)).toBe("/login");
  });

  test("adds the destination to a path with no query", () => {
    expect(withNext("/login", "/cms/sign-in")).toBe(
      "/login?next=%2Fcms%2Fsign-in",
    );
  });

  test("adds the destination to a path that already has a query", () => {
    expect(withNext("/login?error=Nope", "/stack")).toBe(
      "/login?error=Nope&next=%2Fstack",
    );
  });

  test("encodes a destination's own query string as one value", () => {
    expect(withNext("/login", "/search?q=a&page=2")).toBe(
      "/login?next=%2Fsearch%3Fq%3Da%26page%3D2",
    );
  });
});
