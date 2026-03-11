import { describe, expect, mock, test } from "bun:test";
import { createBunRequest } from "../../test-utils/bun-request";
import { createMockVisitorStats } from "../../test-utils/factories";

const mockGetVisitorStats = mock(() => createMockVisitorStats());
mock.module("../../services/analytics", () => ({
  getVisitorStats: mockGetVisitorStats,
}));

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
    test("renders home page with visitor stats", async () => {
      const mockStats = createMockVisitorStats({
        visitorCount: 1234,
        lastUpdated: "2025-09-12T10:00:00.000Z",
      });
      mockGetVisitorStats.mockReturnValue(mockStats);

      const request = createBunRequest("http://localhost:3000/", {
        method: "GET",
      });
      const response = await home.index(request);
      const html = await response.text();

      expect(mockGetVisitorStats).toHaveBeenCalled();
      expect(response.headers.get("content-type")).toBe("text/html");

      expect(html).toContain("Home Page");
      expect(html).toContain("1234");
      expect(html).toContain("9/12/2025, 10:00:00 AM");
    });

    test("passes request method to template", async () => {
      const request = createBunRequest("http://localhost:3000/", {
        method: "POST",
      });
      const response = await home.index(request);
      const html = await response.text();

      expect(html).toContain("POST");
    });
  });
});
