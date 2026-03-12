import { describe, expect, mock, test } from "bun:test";
import { createBunRequest } from "../../test-utils/bun-request";

const mockGetSessionContext = mock(() => ({
  sessionId: null,
  sessionHash: null,
  sessionType: null,
  user: null,
  isGuest: true,
  isAuthenticated: false,
  requiresSetCookie: false,
}));
mock.module("../../middleware/auth", () => ({
  getSessionContext: mockGetSessionContext,
}));

import { home } from "./home";

describe("Home Controller", () => {
  describe("GET /", () => {
    test("renders home page with hero and feature grid", async () => {
      const request = createBunRequest("http://localhost:3000/", {
        method: "GET",
      });
      const response = await home.index(request);
      const html = await response.text();

      expect(response.headers.get("content-type")).toBe("text/html");

      expect(html).toContain("Designed to be built on");
      expect(html).toContain("by AI coding agents");
      expect(html).toContain("Authentication");
      expect(html).toContain("Security");
      expect(html).toContain("Database");
      expect(html).toContain("Testing");
      expect(html).toContain("Frontend");
      expect(html).toContain("Code Quality");
    });
  });
});
