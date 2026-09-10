import type { VisitorStats } from "../services/analytics";
import type { Todo } from "../services/todo";

export const createMockTodo = (overrides: Partial<Todo> = {}): Todo => ({
  id: 1,
  title: "Test Todo",
  completed_at: null,
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
