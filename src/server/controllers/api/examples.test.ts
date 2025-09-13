import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Example } from "../../services/example";
import { createMockExample } from "../../test-utils/factories";
import { createMockRequest } from "../../test-utils/setup";

// Mock the example service
const mockGetExamples = mock(async (): Promise<Example[]> => []);
const mockGetExampleById = mock(async (): Promise<Example | null> => null);
const mockCreateExample = mock(
  async (): Promise<Example> => createMockExample(),
);
const mockUpdateExample = mock(async (): Promise<Example | null> => null);
const mockDeleteExample = mock(async (): Promise<boolean> => false);

mock.module("../../services/example", () => ({
  getExamples: mockGetExamples,
  getExampleById: mockGetExampleById,
  createExample: mockCreateExample,
  updateExample: mockUpdateExample,
  deleteExample: mockDeleteExample,
}));

// Import after mocking
import { examplesApi } from "./examples";

describe("Examples API", () => {
  beforeEach(() => {
    // Reset all mocks
    mockGetExamples.mockClear();
    mockGetExampleById.mockClear();
    mockCreateExample.mockClear();
    mockUpdateExample.mockClear();
    mockDeleteExample.mockClear();
  });

  describe("GET /api/examples", () => {
    test("returns list of examples", async () => {
      const mockExamples = [
        createMockExample({ id: 1, name: "Example 1" }),
        createMockExample({ id: 2, name: "Example 2" }),
      ];
      mockGetExamples.mockResolvedValue(mockExamples);

      const request = createMockRequest("http://localhost:3000/api/examples");
      const response = await examplesApi.index(request);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );

      const data = await response.json();
      expect(data).toEqual(mockExamples);
      expect(mockGetExamples).toHaveBeenCalled();
    });
  });

  describe("GET /api/examples/:id", () => {
    test("returns example when found", async () => {
      const mockExample = createMockExample({ id: 1, name: "Test Example" });
      mockGetExampleById.mockResolvedValue(mockExample);

      const request = createMockRequest("http://localhost:3000/api/examples/1");
      const response = await examplesApi.show(request);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );

      const data = await response.json();
      expect(data).toEqual(mockExample);
      expect(mockGetExampleById).toHaveBeenCalledWith(1);
    });

    test("returns 404 when example not found", async () => {
      mockGetExampleById.mockResolvedValue(null);

      const request = createMockRequest(
        "http://localhost:3000/api/examples/999",
      );
      const response = await examplesApi.show(request);

      expect(response.status).toBe(404);
      const text = await response.text();
      expect(text).toBe("Example not found");
      expect(mockGetExampleById).toHaveBeenCalledWith(999);
    });

    test("handles invalid ID parameter", async () => {
      const request = createMockRequest(
        "http://localhost:3000/api/examples/invalid",
      );
      const _response = await examplesApi.show(request);

      // parseInt("invalid") returns NaN, and Number.parseInt with fallback returns 0
      expect(mockGetExampleById).toHaveBeenCalledWith(Number.NaN);
    });
  });

  describe("POST /api/examples", () => {
    test("creates and returns new example", async () => {
      const newExample = createMockExample({ id: 1, name: "New Example" });
      mockCreateExample.mockResolvedValue(newExample);

      const request = createMockRequest(
        "http://localhost:3000/api/examples",
        "POST",
        { name: "New Example" },
      );
      const response = await examplesApi.create(request);

      expect(response.status).toBe(201);
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );

      const data = await response.json();
      expect(data).toEqual(newExample);
      expect(mockCreateExample).toHaveBeenCalledWith("New Example");
    });
  });

  describe("PUT /api/examples/:id", () => {
    test("updates and returns example when found", async () => {
      const updatedExample = createMockExample({
        id: 1,
        name: "Updated Example",
      });
      mockUpdateExample.mockResolvedValue(updatedExample);

      const request = createMockRequest(
        "http://localhost:3000/api/examples/1",
        "PUT",
        { name: "Updated Example" },
      );
      const response = await examplesApi.update(request);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );

      const data = await response.json();
      expect(data).toEqual(updatedExample);
      expect(mockUpdateExample).toHaveBeenCalledWith(1, "Updated Example");
    });

    test("returns 404 when example not found", async () => {
      mockUpdateExample.mockResolvedValue(null);

      const request = createMockRequest(
        "http://localhost:3000/api/examples/999",
        "PUT",
        { name: "Updated Example" },
      );
      const response = await examplesApi.update(request);

      expect(response.status).toBe(404);
      const text = await response.text();
      expect(text).toBe("Example not found");
      expect(mockUpdateExample).toHaveBeenCalledWith(999, "Updated Example");
    });
  });

  describe("DELETE /api/examples/:id", () => {
    test("deletes example and returns 204", async () => {
      mockDeleteExample.mockResolvedValue(true);

      const request = createMockRequest(
        "http://localhost:3000/api/examples/1",
        "DELETE",
      );
      const response = await examplesApi.destroy(request);

      expect(response.status).toBe(204);
      const text = await response.text();
      expect(text).toBe("");
      expect(mockDeleteExample).toHaveBeenCalledWith(1);
    });

    test("returns 404 when example not found", async () => {
      mockDeleteExample.mockResolvedValue(false);

      const request = createMockRequest(
        "http://localhost:3000/api/examples/999",
        "DELETE",
      );
      const response = await examplesApi.destroy(request);

      expect(response.status).toBe(404);
      const text = await response.text();
      expect(text).toBe("Example not found");
      expect(mockDeleteExample).toHaveBeenCalledWith(999);
    });
  });
});
