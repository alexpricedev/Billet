import { describe, expect, mock, test } from "bun:test";
import { createMockVisitorStats } from "../../test-utils/factories";

// Mock the analytics service
const mockGetVisitorStats = mock(() => createMockVisitorStats());
mock.module("../../services/analytics", () => ({
  getVisitorStats: mockGetVisitorStats,
}));

// Import after mocking
import { statsApi } from "./stats";

describe("Stats API", () => {
  describe("GET /api/stats", () => {
    test("returns visitor stats as JSON", () => {
      const mockStats = createMockVisitorStats({
        visitorCount: 5678,
        lastUpdated: "2025-09-12T12:00:00.000Z",
      });
      mockGetVisitorStats.mockReturnValue(mockStats);

      const response = statsApi.index();

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );

      // Parse the JSON response
      return response.json().then((data) => {
        expect(data).toEqual(mockStats);
        expect(mockGetVisitorStats).toHaveBeenCalled();
      });
    });

    test("returns current visitor stats", () => {
      const response = statsApi.index();

      expect(response.status).toBe(200);
      expect(mockGetVisitorStats).toHaveBeenCalled();
    });
  });
});
