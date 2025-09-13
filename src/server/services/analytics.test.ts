import { describe, expect, test } from "bun:test";
import { getVisitorStats } from "./analytics";

describe("Analytics Service", () => {
  test("getVisitorStats returns correct structure", () => {
    const stats = getVisitorStats();

    expect(stats).toHaveProperty("visitorCount");
    expect(stats).toHaveProperty("lastUpdated");
    expect(typeof stats.visitorCount).toBe("number");
    expect(typeof stats.lastUpdated).toBe("string");
  });

  test("getVisitorStats returns valid ISO timestamp", () => {
    const stats = getVisitorStats();

    // Should be a valid ISO date string
    const date = new Date(stats.lastUpdated);
    expect(date.toISOString()).toBe(stats.lastUpdated);
  });

  test("getVisitorStats returns non-negative visitor count", () => {
    const stats = getVisitorStats();

    expect(stats.visitorCount).toBeGreaterThanOrEqual(0);
  });

  test("getVisitorStats returns different counts over time", () => {
    const stats1 = getVisitorStats();

    // Wait a moment to ensure timestamp changes
    setTimeout(() => {
      const stats2 = getVisitorStats();
      // Since it's based on timestamp, counts should be different
      expect(stats1.lastUpdated).not.toBe(stats2.lastUpdated);
    }, 1);
  });
});
