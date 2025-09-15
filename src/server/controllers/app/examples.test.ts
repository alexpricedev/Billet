import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  createSession,
  createSessionCookie,
  findOrCreateUser,
} from "../../services/auth";
import { createCsrfToken } from "../../services/csrf";
import type { Example } from "../../services/example";
import { createMockExample } from "../../test-utils/factories";

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
  beforeEach(async () => {
    mockGetExamples.mockClear();
    mockCreateExample.mockClear();
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

      const request = new Request("http://localhost:3000/examples");
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

      const request = new Request("http://localhost:3000/examples", {
        headers: { Cookie: cookieHeader },
      });
      const response = await examples.index(request);
      const html = await response.text();

      expect(html).toContain("Examples from Database");
      expect(html).toContain('name="_csrf"');
      expect(html).toContain("Add Example");
      expect(html).not.toContain("Please log in to add examples");
    });

    test("shows success message when success param is true", async () => {
      mockGetExamples.mockResolvedValue([]);

      const request = new Request(
        "http://localhost:3000/examples?success=true",
      );
      const response = await examples.index(request);
      const html = await response.text();

      expect(html).toContain("✅ Example added successfully!");
    });

    test("generates CSRF token for authenticated users", async () => {
      const sessionId = await createTestSession();
      const cookieHeader = createSessionCookie(sessionId);

      mockGetExamples.mockResolvedValue([]);

      const request = new Request("http://localhost:3000/examples", {
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

      const request = new Request("http://localhost:3000/examples", {
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

      const request = new Request("http://localhost:3000/examples", {
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

      const request = new Request("http://localhost:3000/examples", {
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

      const request = new Request("http://localhost:3000/examples", {
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

      const request = new Request("http://localhost:3000/examples", {
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
      expect(response.headers.get("location")).toBe("/examples?success=true");
    });

    test("trims whitespace from name before creating", async () => {
      const sessionId = await createTestSession();
      const cookieHeader = createSessionCookie(sessionId);
      const csrfToken = await createCsrfToken(sessionId, "POST", "/examples");

      const mockFormData = new FormData();
      mockFormData.append("name", "  Trimmed Example  ");
      mockFormData.append("_csrf", csrfToken);

      const request = new Request("http://localhost:3000/examples", {
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
      expect(response.headers.get("location")).toBe("/examples?success=true");
    });

    test("redirects without creating when name is empty", async () => {
      const sessionId = await createTestSession();
      const cookieHeader = createSessionCookie(sessionId);
      const csrfToken = await createCsrfToken(sessionId, "POST", "/examples");

      const mockFormData = new FormData();
      mockFormData.append("name", "");
      mockFormData.append("_csrf", csrfToken);

      const request = new Request("http://localhost:3000/examples", {
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

      const request = new Request("http://localhost:3000/examples", {
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

      const request = new Request("http://localhost:3000/examples", {
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
      expect(response.headers.get("location")).toBe("/examples?success=true");
    });
  });
});
