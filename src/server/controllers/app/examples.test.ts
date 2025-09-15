import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  createSession,
  createSessionCookie,
  findOrCreateUser,
} from "../../services/auth";
import { createCsrfToken } from "../../services/csrf";
import type { Example } from "../../services/example";
import { createBunRequest } from "../../test-utils/bun-request";
import { createMockExample } from "../../test-utils/factories";

// Mock the example service
const mockGetExamples = mock(async (): Promise<Example[]> => []);
const mockCreateExample = mock(
  async (): Promise<Example> => createMockExample(),
);
const mockDeleteExample = mock(async (): Promise<boolean> => true);

mock.module("../../services/example", () => ({
  getExamples: mockGetExamples,
  createExample: mockCreateExample,
  deleteExample: mockDeleteExample,
}));

import { examples } from "./examples";

describe("Examples Controller", () => {
  beforeEach(async () => {
    mockGetExamples.mockClear();
    mockCreateExample.mockClear();
    mockDeleteExample.mockClear();
  });

  const createTestSession = async () => {
    const user = await findOrCreateUser("test@example.com");
    return createSession(user.id);
  };

  describe("GET /examples", () => {
    test("renders examples page for unauthenticated users", async () => {
      const mockExamplesList = [
        createMockExample({ id: 1, name: "Example 1" }),
        createMockExample({ id: 2, name: "Example 2" }),
      ];
      mockGetExamples.mockResolvedValue(mockExamplesList);

      const request = createBunRequest("http://localhost:3000/examples");
      const response = await examples.index(request);
      const html = await response.text();

      expect(mockGetExamples).toHaveBeenCalled();
      expect(response.headers.get("content-type")).toBe("text/html");

      expect(html).toContain("Examples from Database");
      expect(html).toContain("Example 1");
      expect(html).toContain("Example 2");
      expect(html).toContain("log in");
      expect(html).toContain("to add examples");
      expect(html).not.toContain('name="_csrf"');
    });

    test("renders examples page with form for authenticated users", async () => {
      const sessionId = await createTestSession();
      const cookieHeader = createSessionCookie(sessionId);

      mockGetExamples.mockResolvedValue([]);

      const request = createBunRequest("http://localhost:3000/examples", {
        headers: { Cookie: cookieHeader },
      });
      const response = await examples.index(request);
      const html = await response.text();

      expect(html).toContain("Examples from Database");
      expect(html).toContain('name="_csrf"');
      expect(html).toContain("Add Example");
      expect(html).not.toContain("Please log in to add examples");
    });

    test("shows success message when state is submission-success", async () => {
      const sessionId = await createTestSession();
      const cookieHeader = createSessionCookie(sessionId);

      mockGetExamples.mockResolvedValue([]);

      const request = createBunRequest(
        "http://localhost:3000/examples?state=submission-success",
        {
          headers: { Cookie: cookieHeader },
        },
      );
      const response = await examples.index(request);
      const html = await response.text();

      expect(html).toContain("✅ Example added successfully!");
    });

    test("shows different success messages for created and deleted", async () => {
      const sessionId = await createTestSession();
      const cookieHeader = createSessionCookie(sessionId);

      mockGetExamples.mockResolvedValue([]);

      // Test created message
      const createRequest = createBunRequest(
        "http://localhost:3000/examples?state=submission-success",
        {
          headers: { Cookie: cookieHeader },
        },
      );
      const createResponse = await examples.index(createRequest);
      const createHtml = await createResponse.text();

      expect(createHtml).toContain("✅ Example added successfully!");

      // Test deleted message
      const deleteRequest = createBunRequest(
        "http://localhost:3000/examples?state=deletion-success",
        {
          headers: { Cookie: cookieHeader },
        },
      );
      const deleteResponse = await examples.index(deleteRequest);
      const deleteHtml = await deleteResponse.text();

      expect(deleteHtml).toContain("🗑️ Example deleted successfully!");
    });

    test("shows delete buttons for authenticated users with examples", async () => {
      const sessionId = await createTestSession();
      const cookieHeader = createSessionCookie(sessionId);

      const mockExamplesList = [
        createMockExample({ id: 1, name: "Example 1" }),
        createMockExample({ id: 2, name: "Example 2" }),
      ];
      mockGetExamples.mockResolvedValue(mockExamplesList);

      const request = createBunRequest("http://localhost:3000/examples", {
        headers: { Cookie: cookieHeader },
      });
      const response = await examples.index(request);
      const html = await response.text();

      expect(html).toContain("Delete");
      expect(html).toContain('action="/examples/1/delete"');
      expect(html).toContain('action="/examples/2/delete"');
      expect(html).toContain('name="_csrf"');
    });

    test("does not show delete buttons for unauthenticated users", async () => {
      const mockExamplesList = [
        createMockExample({ id: 1, name: "Example 1" }),
        createMockExample({ id: 2, name: "Example 2" }),
      ];
      mockGetExamples.mockResolvedValue(mockExamplesList);

      const request = createBunRequest("http://localhost:3000/examples");
      const response = await examples.index(request);
      const html = await response.text();

      expect(html).not.toContain("<button");
      expect(html).not.toContain('/delete"');
    });

    test("generates CSRF token for authenticated users", async () => {
      const sessionId = await createTestSession();
      const cookieHeader = createSessionCookie(sessionId);

      mockGetExamples.mockResolvedValue([]);

      const request = createBunRequest("http://localhost:3000/examples", {
        headers: { Cookie: cookieHeader },
      });
      const response = await examples.index(request);
      const html = await response.text();

      // Should contain CSRF token field
      expect(html).toContain('name="_csrf"');
      expect(html).toContain('value="');
    });
  });

  describe("POST /examples", () => {
    test("redirects unauthenticated users to login", async () => {
      const mockFormData = new FormData();
      mockFormData.append("name", "New Example");

      const request = createBunRequest("http://localhost:3000/examples", {
        method: "POST",
        headers: { Origin: "http://localhost:3000" },
        body: mockFormData,
      });

      const response = await examples.create(request);

      expect(mockCreateExample).not.toHaveBeenCalled();
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/login");
    });

    test("rejects request without CSRF token", async () => {
      const sessionId = await createTestSession();
      const cookieHeader = createSessionCookie(sessionId);

      const mockFormData = new FormData();
      mockFormData.append("name", "New Example");

      const request = createBunRequest("http://localhost:3000/examples", {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
          Cookie: cookieHeader,
        },
        body: mockFormData,
      });

      const response = await examples.create(request);

      expect(mockCreateExample).not.toHaveBeenCalled();
      expect(response.status).toBe(403);
      expect(await response.text()).toBe("Invalid CSRF token");
    });

    test("rejects request with invalid CSRF token", async () => {
      const sessionId = await createTestSession();
      const cookieHeader = createSessionCookie(sessionId);

      const mockFormData = new FormData();
      mockFormData.append("name", "New Example");
      mockFormData.append("_csrf", "invalid.token");

      const request = createBunRequest("http://localhost:3000/examples", {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
          Cookie: cookieHeader,
        },
        body: mockFormData,
      });

      const response = await examples.create(request);

      expect(mockCreateExample).not.toHaveBeenCalled();
      expect(response.status).toBe(403);
      expect(await response.text()).toBe("Invalid CSRF token");
    });

    test("rejects request without Origin/Referer", async () => {
      const sessionId = await createTestSession();
      const cookieHeader = createSessionCookie(sessionId);
      const csrfToken = await createCsrfToken(sessionId, "POST", "/examples");

      const mockFormData = new FormData();
      mockFormData.append("name", "New Example");
      mockFormData.append("_csrf", csrfToken);

      const request = createBunRequest("http://localhost:3000/examples", {
        method: "POST",
        headers: { Cookie: cookieHeader },
        body: mockFormData,
      });

      const response = await examples.create(request);

      expect(mockCreateExample).not.toHaveBeenCalled();
      expect(response.status).toBe(403);
      expect(await response.text()).toBe("Invalid request origin");
    });

    test("creates example with valid authentication and CSRF token", async () => {
      const sessionId = await createTestSession();
      const cookieHeader = createSessionCookie(sessionId);
      const csrfToken = await createCsrfToken(sessionId, "POST", "/examples");

      const mockFormData = new FormData();
      mockFormData.append("name", "New Example");
      mockFormData.append("_csrf", csrfToken);

      const request = createBunRequest("http://localhost:3000/examples", {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
          Cookie: cookieHeader,
        },
        body: mockFormData,
      });

      const response = await examples.create(request);

      expect(mockCreateExample).toHaveBeenCalledWith("New Example");
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(
        "/examples?state=submission-success",
      );
    });

    test("trims whitespace from name before creating", async () => {
      const sessionId = await createTestSession();
      const cookieHeader = createSessionCookie(sessionId);
      const csrfToken = await createCsrfToken(sessionId, "POST", "/examples");

      const mockFormData = new FormData();
      mockFormData.append("name", "  Trimmed Example  ");
      mockFormData.append("_csrf", csrfToken);

      const request = createBunRequest("http://localhost:3000/examples", {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
          Cookie: cookieHeader,
        },
        body: mockFormData,
      });

      const response = await examples.create(request);

      expect(mockCreateExample).toHaveBeenCalledWith("Trimmed Example");
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(
        "/examples?state=submission-success",
      );
    });

    test("redirects without creating when name is empty", async () => {
      const sessionId = await createTestSession();
      const cookieHeader = createSessionCookie(sessionId);
      const csrfToken = await createCsrfToken(sessionId, "POST", "/examples");

      const mockFormData = new FormData();
      mockFormData.append("name", "");
      mockFormData.append("_csrf", csrfToken);

      const request = createBunRequest("http://localhost:3000/examples", {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
          Cookie: cookieHeader,
        },
        body: mockFormData,
      });

      const response = await examples.create(request);

      expect(mockCreateExample).not.toHaveBeenCalled();
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/examples");
    });

    test("redirects without creating when name is too short", async () => {
      const sessionId = await createTestSession();
      const cookieHeader = createSessionCookie(sessionId);
      const csrfToken = await createCsrfToken(sessionId, "POST", "/examples");

      const mockFormData = new FormData();
      mockFormData.append("name", "x");
      mockFormData.append("_csrf", csrfToken);

      const request = createBunRequest("http://localhost:3000/examples", {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
          Cookie: cookieHeader,
        },
        body: mockFormData,
      });

      const response = await examples.create(request);

      expect(mockCreateExample).not.toHaveBeenCalled();
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/examples");
    });

    test("works with CSRF token in header instead of form", async () => {
      const sessionId = await createTestSession();
      const cookieHeader = createSessionCookie(sessionId);
      const csrfToken = await createCsrfToken(sessionId, "POST", "/examples");

      const mockFormData = new FormData();
      mockFormData.append("name", "Header Token Example");

      const request = createBunRequest("http://localhost:3000/examples", {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
          Cookie: cookieHeader,
          "X-CSRF-Token": csrfToken,
        },
        body: mockFormData,
      });

      const response = await examples.create(request);

      expect(mockCreateExample).toHaveBeenCalledWith("Header Token Example");
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(
        "/examples?state=submission-success",
      );
    });
  });

  describe("POST /examples/:id/delete", () => {
    test("redirects unauthenticated users to login", async () => {
      const request = createBunRequest<"/examples/:id/delete">(
        "http://localhost:3000/examples/42/delete",
        {
          method: "POST",
          headers: { Origin: "http://localhost:3000" },
          body: new FormData(),
        },
        { id: "42" },
      );

      const response = await examples.destroy(request);

      expect(mockDeleteExample).not.toHaveBeenCalled();
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/login");
    });

    test("rejects request without CSRF token", async () => {
      const sessionId = await createTestSession();
      const cookieHeader = createSessionCookie(sessionId);

      const request = createBunRequest<"/examples/:id/delete">(
        "http://localhost:3000/examples/42/delete",
        {
          method: "POST",
          headers: {
            Origin: "http://localhost:3000",
            Cookie: cookieHeader,
          },
          body: new FormData(),
        },
        { id: "42" },
      );

      const response = await examples.destroy(request);

      expect(mockDeleteExample).not.toHaveBeenCalled();
      expect(response.status).toBe(403);
      expect(await response.text()).toBe("Invalid CSRF token");
    });

    test("deletes example with valid authentication and CSRF token", async () => {
      const sessionId = await createTestSession();
      const cookieHeader = createSessionCookie(sessionId);
      const csrfToken = await createCsrfToken(
        sessionId,
        "POST",
        "/examples/42/delete",
      );

      mockDeleteExample.mockResolvedValue(true);

      const mockFormData = new FormData();
      mockFormData.append("_csrf", csrfToken);

      const request = createBunRequest<"/examples/:id/delete">(
        "http://localhost:3000/examples/42/delete",
        {
          method: "POST",
          headers: {
            Origin: "http://localhost:3000",
            Cookie: cookieHeader,
          },
          body: mockFormData,
        },
        { id: "42" },
      );

      const response = await examples.destroy(request);

      expect(response.status).toBe(303);
      expect(mockDeleteExample).toHaveBeenCalledWith(42);
      expect(response.headers.get("location")).toBe(
        "/examples?state=deletion-success",
      );
    });

    test("redirects without error when example not found", async () => {
      const sessionId = await createTestSession();
      const cookieHeader = createSessionCookie(sessionId);
      const csrfToken = await createCsrfToken(
        sessionId,
        "POST",
        "/examples/999/delete",
      );

      mockDeleteExample.mockResolvedValue(false);

      const mockFormData = new FormData();
      mockFormData.append("_csrf", csrfToken);

      const request = createBunRequest<"/examples/:id/delete">(
        "http://localhost:3000/examples/999/delete",
        {
          method: "POST",
          headers: {
            Origin: "http://localhost:3000",
            Cookie: cookieHeader,
          },
          body: mockFormData,
        },
        { id: "999" },
      );

      const response = await examples.destroy(request);

      expect(mockDeleteExample).toHaveBeenCalledWith(999);
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/examples");
    });

    test("redirects when id is not a valid number", async () => {
      const sessionId = await createTestSession();
      const cookieHeader = createSessionCookie(sessionId);
      const csrfToken = await createCsrfToken(
        sessionId,
        "POST",
        "/examples/invalid/delete",
      );

      const mockFormData = new FormData();
      mockFormData.append("_csrf", csrfToken);

      const request = createBunRequest<"/examples/:id/delete">(
        "http://localhost:3000/examples/invalid/delete",
        {
          method: "POST",
          headers: {
            Origin: "http://localhost:3000",
            Cookie: cookieHeader,
          },
          body: mockFormData,
        },
        { id: "invalid" },
      );

      const response = await examples.destroy(request);

      expect(mockDeleteExample).not.toHaveBeenCalled();
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/examples");
    });
  });
});
