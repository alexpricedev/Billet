import type { VisitorStats } from "../services/analytics";
import type { Example } from "../services/example";

export const createMockExample = (
  overrides: Partial<Example> = {},
): Example => ({
  id: 1,
  name: "Test Example",
  ...overrides,
});

export const createMockVisitorStats = (
  overrides: Partial<VisitorStats> = {},
): VisitorStats => ({
  visitorCount: 1234,
  lastUpdated: "2025-09-12T10:00:00.000Z",
  ...overrides,
});
