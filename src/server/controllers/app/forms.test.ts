import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { SQL } from "bun";
import { findOrCreateUser } from "../../services/auth";
import { createCsrfToken } from "../../services/csrf";
import {
  createAuthenticatedSession,
  createGuestSession,
} from "../../services/sessions";
import type { FormsState } from "../../templates/forms";
import { createBunRequest, findSetCookie } from "../../test-utils/bun-request";
import { cleanupTestData, randomEmail } from "../../test-utils/helpers";
import { stateHelpers } from "../../utils/state";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for tests");
}
const connection = new SQL(process.env.DATABASE_URL);

mock.module("../../services/database", () => ({
  get db() {
    return connection;
  },
}));

import { db } from "../../services/database";
import { forms } from "./forms";

describe("Forms Controller", () => {
  beforeEach(async () => {
    await cleanupTestData(db);
  });

  afterAll(async () => {
    await connection.end();
    mock.restore();
  });

  const createTestSession = async () => {
    const user = await findOrCreateUser(randomEmail());
    return createAuthenticatedSession(user.id);
  };

  describe("GET /forms", () => {
    test("renders forms page with CSRF token for guest session", async () => {
      const guestSessionId = await createGuestSession();

      const request = createBunRequest("http://localhost:3000/forms", {
        headers: { Cookie: `session_id=${guestSessionId}` },
      });
      const response = await forms.index(request);
      const html = await response.text();

      expect(response.headers.get("content-type")).toBe("text/html");
      expect(html).toContain("Form Patterns");
      expect(html).toContain('name="_csrf"');
      expect(html).toContain('action="/forms"');
      expect(html).toContain('method="POST"');
    });

    test("renders forms page with CSRF token for authenticated users", async () => {
      const sessionId = await createTestSession();

      const request = createBunRequest("http://localhost:3000/forms", {
        headers: { Cookie: `session_id=${sessionId}` },
      });
      const response = await forms.index(request);
      const html = await response.text();

      expect(html).toContain("Form Patterns");
      expect(html).toContain('name="_csrf"');
      expect(html).toContain('action="/forms"');
    });

    test("renders forms page with new session for first-time visitors", async () => {
      const request = createBunRequest("http://localhost:3000/forms");
      const response = await forms.index(request);
      const html = await response.text();

      expect(html).toContain("Form Patterns");
      expect(html).toContain('name="_csrf"');
    });

    test("shows flash message when state is submission-success", async () => {
      const sessionId = await createTestSession();

      const request = createBunRequest("http://localhost:3000/forms", {
        headers: { Cookie: `session_id=${sessionId}` },
      });

      const { setFlash } = stateHelpers<FormsState>();
      setFlash(request, {
        state: "submission-success",
        name: "Alex",
        email: "alex@example.com",
        message: "Hello world",
      });

      const response = await forms.index(request);
      const html = await response.text();

      expect(html).toContain("Submitted successfully");
      expect(html).toContain("Alex");
      expect(html).toContain("alex@example.com");
      expect(html).toContain("Hello world");
    });

    test("does not show flash message when no state", async () => {
      const sessionId = await createTestSession();

      const request = createBunRequest("http://localhost:3000/forms", {
        headers: { Cookie: `session_id=${sessionId}` },
      });

      const response = await forms.index(request);
      const html = await response.text();

      expect(html).not.toContain("Submitted successfully");
    });
  });

  describe("POST /forms", () => {
    test("sets flash and redirects with valid submission", async () => {
      const sessionId = await createGuestSession();
      const cookieHeader = `session_id=${sessionId}`;
      const csrfToken = await createCsrfToken(sessionId, "POST", "/forms");

      const mockFormData = new FormData();
      mockFormData.append("name", "Alex");
      mockFormData.append("email", "alex@example.com");
      mockFormData.append("message", "Hello world");
      mockFormData.append("_csrf", csrfToken);

      const request = createBunRequest("http://localhost:3000/forms", {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
          Cookie: cookieHeader,
        },
        body: mockFormData,
      });

      const response = await forms.create(request);

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/forms");

      const setCookie = findSetCookie(request, "flash_state");
      expect(setCookie).toBeDefined();
      expect(setCookie).toContain("submission-success");
      expect(setCookie).toContain("Alex");
    });

    test("redirects without flash when name is missing", async () => {
      const sessionId = await createGuestSession();
      const cookieHeader = `session_id=${sessionId}`;
      const csrfToken = await createCsrfToken(sessionId, "POST", "/forms");

      const mockFormData = new FormData();
      mockFormData.append("name", "");
      mockFormData.append("_csrf", csrfToken);

      const request = createBunRequest("http://localhost:3000/forms", {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
          Cookie: cookieHeader,
        },
        body: mockFormData,
      });

      const response = await forms.create(request);

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/forms");

      const setCookie = findSetCookie(request, "flash_state");
      expect(setCookie).toBeUndefined();
    });

    test("redirects without flash when name is too short", async () => {
      const sessionId = await createGuestSession();
      const cookieHeader = `session_id=${sessionId}`;
      const csrfToken = await createCsrfToken(sessionId, "POST", "/forms");

      const mockFormData = new FormData();
      mockFormData.append("name", "ab");
      mockFormData.append("_csrf", csrfToken);

      const request = createBunRequest("http://localhost:3000/forms", {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
          Cookie: cookieHeader,
        },
        body: mockFormData,
      });

      const response = await forms.create(request);

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/forms");

      const setCookie = findSetCookie(request, "flash_state");
      expect(setCookie).toBeUndefined();
    });

    test("rejects request without CSRF token", async () => {
      const sessionId = await createGuestSession();
      const cookieHeader = `session_id=${sessionId}`;

      const mockFormData = new FormData();
      mockFormData.append("name", "Alex");

      const request = createBunRequest("http://localhost:3000/forms", {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
          Cookie: cookieHeader,
        },
        body: mockFormData,
      });

      const response = await forms.create(request);

      expect(response.status).toBe(403);
      expect(await response.text()).toBe("Invalid CSRF token");
    });

    test("rejects request without session cookie", async () => {
      const mockFormData = new FormData();
      mockFormData.append("name", "Alex");

      const request = createBunRequest("http://localhost:3000/forms", {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
        },
        body: mockFormData,
      });

      const response = await forms.create(request);

      expect(response.status).toBe(403);
      expect(await response.text()).toBe("Invalid CSRF token");
    });

    test("trims whitespace from submitted values", async () => {
      const sessionId = await createGuestSession();
      const cookieHeader = `session_id=${sessionId}`;
      const csrfToken = await createCsrfToken(sessionId, "POST", "/forms");

      const mockFormData = new FormData();
      mockFormData.append("name", "  Alex  ");
      mockFormData.append("email", "  alex@example.com  ");
      mockFormData.append("message", "  Hello  ");
      mockFormData.append("_csrf", csrfToken);

      const request = createBunRequest("http://localhost:3000/forms", {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
          Cookie: cookieHeader,
        },
        body: mockFormData,
      });

      const response = await forms.create(request);

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/forms");

      const setCookie = findSetCookie(request, "flash_state");
      expect(setCookie).toBeDefined();
      expect(setCookie).toContain("submission-success");
    });

    test("works with CSRF token in header", async () => {
      const sessionId = await createGuestSession();
      const cookieHeader = `session_id=${sessionId}`;
      const csrfToken = await createCsrfToken(sessionId, "POST", "/forms");

      const mockFormData = new FormData();
      mockFormData.append("name", "Alex");

      const request = createBunRequest("http://localhost:3000/forms", {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
          Cookie: cookieHeader,
          "X-CSRF-Token": csrfToken,
        },
        body: mockFormData,
      });

      const response = await forms.create(request);

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/forms");

      const setCookie = findSetCookie(request, "flash_state");
      expect(setCookie).toBeDefined();
      expect(setCookie).toContain("submission-success");
    });
  });
});
