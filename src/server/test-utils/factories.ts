import type { VisitorStats } from "../services/analytics";
import type { Project } from "../services/project";

export const createMockProject = (
  overrides: Partial<Project> = {},
): Project => ({
  id: 1,
  title: "Test Project",
  created_by: null,
  ...overrides,
});

export const createMockVisitorStats = (
  overrides: Partial<VisitorStats> = {},
): VisitorStats => ({
  visitorCount: 1234,
  lastUpdated: "2025-09-12T10:00:00.000Z",
  ...overrides,
});
