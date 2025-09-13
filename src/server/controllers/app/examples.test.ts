import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Example } from "../../services/example";
import { createMockExample } from "../../test-utils/factories";
import { createMockRequest } from "../../test-utils/setup";

// Mock the example service
const mockGetExamples = mock(async (): Promise<Example[]> => []);
const mockCreateExample = mock(
  async (): Promise<Example> => createMockExample(),
);

mock.module("../../services/example", () => ({
  getExamples: mockGetExamples,
  createExample: mockCreateExample,
}));

import { examples } from "./examples";

describe("Examples Controller", () => {
  beforeEach(() => {
    // Reset all mocks
    mockGetExamples.mockClear();
    mockCreateExample.mockClear();
  });

  describe("GET /examples", () => {
    test("renders examples page with list of examples", async () => {
      const mockExamplesList = [
        createMockExample({ id: 1, name: "Example 1" }),
        createMockExample({ id: 2, name: "Example 2" }),
      ];
      mockGetExamples.mockResolvedValue(mockExamplesList);

      const request = createMockRequest("http://localhost:3000/examples");
      const response = await examples.index(request);
      const html = await response.text();

      expect(mockGetExamples).toHaveBeenCalled();
      expect(response.headers.get("content-type")).toBe("text/html");

      // Test actual HTML content
      expect(html).toContain("Examples from Database");
      expect(html).toContain("Example 1");
      expect(html).toContain("Example 2");
      expect(html).toContain("ID: <!-- -->1");
      expect(html).toContain("ID: <!-- -->2");
      expect(html).not.toContain("✅ Example added successfully!");
    });

    test("shows success message when success param is true", async () => {
      mockGetExamples.mockResolvedValue([]);

      const request = createMockRequest(
        "http://localhost:3000/examples?success=true",
      );
      const response = await examples.index(request);
      const html = await response.text();

      expect(html).toContain("✅ Example added successfully!");
    });

    test("does not show success message when success param is false", async () => {
      mockGetExamples.mockResolvedValue([]);

      const request = createMockRequest(
        "http://localhost:3000/examples?success=false",
      );
      const response = await examples.index(request);
      const html = await response.text();

      expect(html).not.toContain("✅ Example added successfully!");
    });
  });

  describe("POST /examples", () => {
    test("creates example and redirects with success", async () => {
      const mockFormData = new FormData();
      mockFormData.append("name", "New Example");

      const request = new Request("http://localhost:3000/examples", {
        method: "POST",
        body: mockFormData,
      });

      const response = await examples.create(request);

      expect(mockCreateExample).toHaveBeenCalledWith("New Example");
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/examples?success=true");
    });

    test("trims whitespace from name before creating", async () => {
      const mockFormData = new FormData();
      mockFormData.append("name", "  Trimmed Example  ");

      const request = new Request("http://localhost:3000/examples", {
        method: "POST",
        body: mockFormData,
      });

      const response = await examples.create(request);

      expect(mockCreateExample).toHaveBeenCalledWith("Trimmed Example");
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/examples?success=true");
    });

    test("redirects without creating when name is empty", async () => {
      const mockFormData = new FormData();
      mockFormData.append("name", "");

      const request = new Request("http://localhost:3000/examples", {
        method: "POST",
        body: mockFormData,
      });

      const response = await examples.create(request);

      expect(mockCreateExample).not.toHaveBeenCalled();
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/examples");
    });

    test("redirects without creating when name is too short", async () => {
      const mockFormData = new FormData();
      mockFormData.append("name", "x");

      const request = new Request("http://localhost:3000/examples", {
        method: "POST",
        body: mockFormData,
      });

      const response = await examples.create(request);

      expect(mockCreateExample).not.toHaveBeenCalled();
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/examples");
    });

    test("redirects without creating when name is only whitespace", async () => {
      const mockFormData = new FormData();
      mockFormData.append("name", "   ");

      const request = new Request("http://localhost:3000/examples", {
        method: "POST",
        body: mockFormData,
      });

      const response = await examples.create(request);

      expect(mockCreateExample).not.toHaveBeenCalled();
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/examples");
    });

    test("redirects without creating when name field is missing", async () => {
      const mockFormData = new FormData();

      const request = new Request("http://localhost:3000/examples", {
        method: "POST",
        body: mockFormData,
      });

      const response = await examples.create(request);

      expect(mockCreateExample).not.toHaveBeenCalled();
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/examples");
    });
  });
});
