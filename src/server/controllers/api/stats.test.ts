import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { clearRateLimitLog } from "../../middleware/rate-limit";
import { createMockVisitorStats } from "../../test-utils/factories";
import { createMockRequest, expectJsonError } from "../../test-utils/setup";

// Mock the analytics service
const mockGetVisitorStats = mock(() => createMockVisitorStats());
mock.module("../../services/analytics", () => ({
  getVisitorStats: mockGetVisitorStats,
}));

// Import after mocking
import { statsApi } from "./stats";

const request = () => createMockRequest("http://localhost:3000/api/stats");

describe("Stats API", () => {
  afterAll(() => {
    mock.restore();
  });

  beforeEach(() => {
    mockGetVisitorStats.mockClear();
    clearRateLimitLog();
  });

  describe("GET /api/stats", () => {
    test("returns visitor stats as JSON", async () => {
      const mockStats = createMockVisitorStats({
        visitorCount: 5678,
        lastUpdated: "2025-09-12T12:00:00.000Z",
      });
      mockGetVisitorStats.mockReturnValue(mockStats);

      const response = statsApi.index(request());

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );

      // Wrapped in `data`, like every other API payload — a bare top-level
      // object leaves nowhere to add metadata later.
      expect(await response.json()).toEqual({ data: mockStats });
      expect(mockGetVisitorStats).toHaveBeenCalled();
    });

    test("returns current visitor stats", () => {
      const response = statsApi.index(request());

      expect(response.status).toBe(200);
      expect(mockGetVisitorStats).toHaveBeenCalled();
    });

    test("returns 429 once the per-IP read limit is exceeded", async () => {
      for (let i = 0; i < 60; i++) {
        expect(statsApi.index(request()).status).toBe(200);
      }

      await expectJsonError(statsApi.index(request()), 429, "rate_limited");
    });
  });
});
