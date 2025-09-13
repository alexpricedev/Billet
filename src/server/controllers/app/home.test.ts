import { describe, expect, mock, test } from "bun:test";
import { createMockVisitorStats } from "../../test-utils/factories";
import { createMockRequest } from "../../test-utils/setup";

// Mock the analytics service
const mockGetVisitorStats = mock(() => createMockVisitorStats());
mock.module("../../services/analytics", () => ({
  getVisitorStats: mockGetVisitorStats,
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

      const request = createMockRequest("http://localhost:3000/", "GET");
      const response = home.index(request);
      const html = await response.text();

      expect(mockGetVisitorStats).toHaveBeenCalled();
      expect(response.headers.get("content-type")).toBe("text/html");

      // Test actual HTML content
      expect(html).toContain("Home Page");
      expect(html).toContain("1234");
      expect(html).toContain("9/12/2025, 10:00:00 AM");
    });

    test("passes request method to template", async () => {
      // Create request directly with POST method
      const request = new Request("http://localhost:3000/", { method: "POST" });
      const response = home.index(request);
      const html = await response.text();

      // The HTML should contain the POST method somewhere
      expect(html).toContain("POST");
    });
  });
});
