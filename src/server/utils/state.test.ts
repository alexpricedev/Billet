import { describe, expect, test } from "bun:test";
import {
  createBunRequest,
  getSetCookieHeaders,
} from "../test-utils/bun-request";
import { stateHelpers } from "./state";

interface TestState {
  success?: boolean;
  error?: string;
}

describe("State Helpers", () => {
  const helpers = stateHelpers<TestState>();

  test("sets and gets flash state", () => {
    const req = createBunRequest("http://localhost:3000/test");

    helpers.setFlash(req, { success: true });

    const setCookies = getSetCookieHeaders(req);
    expect(setCookies.length).toBeGreaterThan(0);
    expect(setCookies[0]).toContain("flash_state=");

    const result = helpers.getFlash(req);
    expect(result.success).toBe(true);
  });

  test("deletes flash cookie after reading", () => {
    const req = createBunRequest("http://localhost:3000/test");

    helpers.setFlash(req, { success: true });

    const firstRead = helpers.getFlash(req);
    expect(firstRead.success).toBe(true);

    const deleteCookies = getSetCookieHeaders(req);
    const hasDeletion = deleteCookies.some(
      (cookie) =>
        cookie.includes("flash_state=") && cookie.includes("Max-Age=0"),
    );
    expect(hasDeletion).toBe(true);

    const secondRead = helpers.getFlash(req);
    expect(secondRead).toEqual({});
  });

  test("returns empty object for missing flash cookie", () => {
    const req = createBunRequest("http://localhost:3000/test");

    const result = helpers.getFlash(req);
    expect(result).toEqual({});
  });

  test("rejects cookie with tampered signature", () => {
    const req = createBunRequest("http://localhost:3000/test");

    helpers.setFlash(req, { success: true });

    const setCookies = getSetCookieHeaders(req);
    const cookieValue = setCookies[0]?.match(/flash_state=([^;]+)/)?.[1];

    if (cookieValue) {
      const parts = cookieValue.split(".");
      const tamperedValue = `badsignature.${parts.slice(1).join(".")}`;

      const req2 = createBunRequest("http://localhost:3000/test", {
        headers: {
          cookie: `flash_state=${tamperedValue}`,
        },
      });

      const result = helpers.getFlash(req2);
      expect(result).toEqual({});
    }
  });

  test("sets correct cookie attributes", () => {
    const req = createBunRequest("http://localhost:3000/test");

    helpers.setFlash(req, { success: true });

    const setCookies = getSetCookieHeaders(req);
    const cookieString = setCookies[0];

    expect(cookieString).toContain("HttpOnly");
    expect(cookieString).toContain("Path=/");
    expect(cookieString).toContain("Max-Age=300");
    expect(cookieString).toContain("SameSite=Lax");
  });

  test("handles complex state objects", () => {
    const req = createBunRequest("http://localhost:3000/test");

    helpers.setFlash(req, { success: true, error: "Something failed" });

    const result = helpers.getFlash(req);
    expect(result.success).toBe(true);
    expect(result.error).toBe("Something failed");
  });
});
