import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { SQL } from "bun";
import { findOrCreateUser } from "../../services/auth";
import { createCsrfToken } from "../../services/csrf";
import type { Project } from "../../services/project";
import { createAuthenticatedSession } from "../../services/sessions";
import type { ProjectsState } from "../../templates/projects";
import { createBunRequest, findSetCookie } from "../../test-utils/bun-request";
import { createMockProject } from "../../test-utils/factories";
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

const mockGetProjects = mock(async (): Promise<Project[]> => []);
const mockCreateProject = mock(
  async (): Promise<Project> => createMockProject(),
);
const mockDeleteProject = mock(async (): Promise<boolean> => true);

mock.module("../../services/project", () => ({
  getProjects: mockGetProjects,
  createProject: mockCreateProject,
  deleteProject: mockDeleteProject,
}));

import { db } from "../../services/database";
import { projects } from "./projects";

describe("Projects Controller", () => {
  beforeEach(async () => {
    await cleanupTestData(db);
    mockGetProjects.mockClear();
    mockCreateProject.mockClear();
    mockDeleteProject.mockClear();
  });

  afterAll(async () => {
    await connection.end();
  });

  const createTestSession = async () => {
    const user = await findOrCreateUser(randomEmail());
    return createAuthenticatedSession(user.id);
  };

  describe("GET /projects", () => {
    test("renders projects page for unauthenticated users", async () => {
      const mockProjectsList = [
        createMockProject({ id: 1, title: "Project 1" }),
        createMockProject({ id: 2, title: "Project 2" }),
      ];
      mockGetProjects.mockResolvedValue(mockProjectsList);

      const request = createBunRequest("http://localhost:3000/projects");
      const response = await projects.index(request);
      const html = await response.text();

      expect(mockGetProjects).toHaveBeenCalled();
      expect(response.headers.get("content-type")).toBe("text/html");

      expect(html).toContain("Projects");
      expect(html).toContain("Project 1");
      expect(html).toContain("Project 2");
      expect(html).toContain("Sign in");
      expect(html).toContain("to create projects");
      expect(html).not.toContain('name="_csrf"');
    });

    test("renders projects page with form for authenticated users", async () => {
      const sessionId = await createTestSession();

      mockGetProjects.mockResolvedValue([]);

      const request = createBunRequest("http://localhost:3000/projects", {
        headers: { Cookie: `session_id=${sessionId}` },
      });
      const response = await projects.index(request);
      const html = await response.text();

      expect(html).toContain("Projects");
      expect(html).toContain('name="_csrf"');
      expect(html).toContain("Add Project");
      expect(html).not.toContain("Sign in");
    });

    test("shows success message when state is submission-success", async () => {
      const sessionId = await createTestSession();
      const sessionCookieHeader = `session_id=${sessionId}`;

      mockGetProjects.mockResolvedValue([]);

      const request = createBunRequest("http://localhost:3000/projects", {
        headers: {
          Cookie: sessionCookieHeader,
        },
      });

      const { setFlash } = stateHelpers<ProjectsState>();
      setFlash(request, {
        state: "submission-success",
      });

      const response = await projects.index(request);
      const html = await response.text();

      expect(html).toContain("Project added successfully.");
    });

    test("shows different success messages for created and deleted", async () => {
      const sessionId = await createTestSession();
      const sessionCookieHeader = `session_id=${sessionId}`;

      mockGetProjects.mockResolvedValue([]);

      const createRequest = createBunRequest("http://localhost:3000/projects", {
        headers: {
          Cookie: sessionCookieHeader,
        },
      });
      const { setFlash: setCreateFlash } = stateHelpers<ProjectsState>();
      setCreateFlash(createRequest, {
        state: "submission-success",
      });
      const createResponse = await projects.index(createRequest);
      const createHtml = await createResponse.text();

      expect(createHtml).toContain("Project added successfully.");

      const deleteRequest = createBunRequest("http://localhost:3000/projects", {
        headers: {
          Cookie: sessionCookieHeader,
        },
      });
      const { setFlash: setDeleteFlash } = stateHelpers<ProjectsState>();
      setDeleteFlash(deleteRequest, {
        state: "deletion-success",
      });
      const deleteResponse = await projects.index(deleteRequest);
      const deleteHtml = await deleteResponse.text();

      expect(deleteHtml).toContain("Project deleted successfully.");
    });

    test("shows delete buttons for authenticated users with projects", async () => {
      const sessionId = await createTestSession();
      const cookieHeader = `session_id=${sessionId}`;

      const mockProjectsList = [
        createMockProject({ id: 1, title: "Project 1" }),
        createMockProject({ id: 2, title: "Project 2" }),
      ];
      mockGetProjects.mockResolvedValue(mockProjectsList);

      const request = createBunRequest("http://localhost:3000/projects", {
        headers: { Cookie: cookieHeader },
      });
      const response = await projects.index(request);
      const html = await response.text();

      expect(html).toContain("Delete");
      expect(html).toContain('action="/projects/1/delete"');
      expect(html).toContain('action="/projects/2/delete"');
      expect(html).toContain('name="_csrf"');
    });

    test("does not show delete buttons for unauthenticated users", async () => {
      const mockProjectsList = [
        createMockProject({ id: 1, title: "Project 1" }),
        createMockProject({ id: 2, title: "Project 2" }),
      ];
      mockGetProjects.mockResolvedValue(mockProjectsList);

      const request = createBunRequest("http://localhost:3000/projects");
      const response = await projects.index(request);
      const html = await response.text();

      expect(html).not.toContain("Delete</button");
      expect(html).not.toContain('/delete"');
    });

    test("generates CSRF token for authenticated users", async () => {
      const sessionId = await createTestSession();
      const cookieHeader = `session_id=${sessionId}`;

      mockGetProjects.mockResolvedValue([]);

      const request = createBunRequest("http://localhost:3000/projects", {
        headers: { Cookie: cookieHeader },
      });
      const response = await projects.index(request);
      const html = await response.text();

      expect(html).toContain('name="_csrf"');
      expect(html).toContain('value="');
    });
  });

  describe("POST /projects", () => {
    test("redirects unauthenticated users to login", async () => {
      const mockFormData = new FormData();
      mockFormData.append("title", "New Project");

      const request = createBunRequest("http://localhost:3000/projects", {
        method: "POST",
        headers: { Origin: "http://localhost:3000" },
        body: mockFormData,
      });

      const response = await projects.create(request);

      expect(mockCreateProject).not.toHaveBeenCalled();
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/login");
    });

    test("rejects request without CSRF token", async () => {
      const sessionId = await createTestSession();
      const cookieHeader = `session_id=${sessionId}`;

      const mockFormData = new FormData();
      mockFormData.append("title", "New Project");

      const request = createBunRequest("http://localhost:3000/projects", {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
          Cookie: cookieHeader,
        },
        body: mockFormData,
      });

      const response = await projects.create(request);

      expect(mockCreateProject).not.toHaveBeenCalled();
      expect(response.status).toBe(403);
      expect(await response.text()).toBe("Invalid CSRF token");
    });

    test("rejects request with invalid CSRF token", async () => {
      const sessionId = await createTestSession();
      const cookieHeader = `session_id=${sessionId}`;

      const mockFormData = new FormData();
      mockFormData.append("title", "New Project");
      mockFormData.append("_csrf", "invalid.token");

      const request = createBunRequest("http://localhost:3000/projects", {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
          Cookie: cookieHeader,
        },
        body: mockFormData,
      });

      const response = await projects.create(request);

      expect(mockCreateProject).not.toHaveBeenCalled();
      expect(response.status).toBe(403);
      expect(await response.text()).toBe("Invalid CSRF token");
    });

    test("rejects request without Origin/Referer", async () => {
      const sessionId = await createTestSession();
      const cookieHeader = `session_id=${sessionId}`;
      const csrfToken = await createCsrfToken(sessionId, "POST", "/projects");

      const mockFormData = new FormData();
      mockFormData.append("title", "New Project");
      mockFormData.append("_csrf", csrfToken);

      const request = createBunRequest("http://localhost:3000/projects", {
        method: "POST",
        headers: { Cookie: cookieHeader },
        body: mockFormData,
      });

      const response = await projects.create(request);

      expect(mockCreateProject).not.toHaveBeenCalled();
      expect(response.status).toBe(403);
      expect(await response.text()).toBe("Invalid request origin");
    });

    test("creates project with valid authentication and CSRF token", async () => {
      const sessionId = await createTestSession();
      const cookieHeader = `session_id=${sessionId}`;
      const csrfToken = await createCsrfToken(sessionId, "POST", "/projects");

      const mockFormData = new FormData();
      mockFormData.append("title", "New Project");
      mockFormData.append("_csrf", csrfToken);

      const request = createBunRequest("http://localhost:3000/projects", {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
          Cookie: cookieHeader,
        },
        body: mockFormData,
      });

      const response = await projects.create(request);

      expect(mockCreateProject).toHaveBeenCalledWith("New Project");
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/projects");

      const setCookie = findSetCookie(request, "flash_state");
      expect(setCookie).toBeDefined();
      expect(setCookie).toContain("submission-success");
    });

    test("trims whitespace from title before creating", async () => {
      const sessionId = await createTestSession();
      const cookieHeader = `session_id=${sessionId}`;
      const csrfToken = await createCsrfToken(sessionId, "POST", "/projects");

      const mockFormData = new FormData();
      mockFormData.append("title", "  Trimmed Project  ");
      mockFormData.append("_csrf", csrfToken);

      const request = createBunRequest("http://localhost:3000/projects", {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
          Cookie: cookieHeader,
        },
        body: mockFormData,
      });

      const response = await projects.create(request);

      expect(mockCreateProject).toHaveBeenCalledWith("Trimmed Project");
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/projects");

      const setCookie = findSetCookie(request, "flash_state");
      expect(setCookie).toBeDefined();
      expect(setCookie).toContain("submission-success");
    });

    test("redirects without creating when title is empty", async () => {
      const sessionId = await createTestSession();
      const cookieHeader = `session_id=${sessionId}`;
      const csrfToken = await createCsrfToken(sessionId, "POST", "/projects");

      const mockFormData = new FormData();
      mockFormData.append("title", "");
      mockFormData.append("_csrf", csrfToken);

      const request = createBunRequest("http://localhost:3000/projects", {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
          Cookie: cookieHeader,
        },
        body: mockFormData,
      });

      const response = await projects.create(request);

      expect(mockCreateProject).not.toHaveBeenCalled();
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/projects");
    });

    test("redirects without creating when title is too short", async () => {
      const sessionId = await createTestSession();
      const cookieHeader = `session_id=${sessionId}`;
      const csrfToken = await createCsrfToken(sessionId, "POST", "/projects");

      const mockFormData = new FormData();
      mockFormData.append("title", "x");
      mockFormData.append("_csrf", csrfToken);

      const request = createBunRequest("http://localhost:3000/projects", {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
          Cookie: cookieHeader,
        },
        body: mockFormData,
      });

      const response = await projects.create(request);

      expect(mockCreateProject).not.toHaveBeenCalled();
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/projects");
    });

    test("works with CSRF token in header instead of form", async () => {
      const sessionId = await createTestSession();
      const cookieHeader = `session_id=${sessionId}`;
      const csrfToken = await createCsrfToken(sessionId, "POST", "/projects");

      const mockFormData = new FormData();
      mockFormData.append("title", "Header Token Project");

      const request = createBunRequest("http://localhost:3000/projects", {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
          Cookie: cookieHeader,
          "X-CSRF-Token": csrfToken,
        },
        body: mockFormData,
      });

      const response = await projects.create(request);

      expect(mockCreateProject).toHaveBeenCalledWith("Header Token Project");
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/projects");

      const setCookie = findSetCookie(request, "flash_state");
      expect(setCookie).toBeDefined();
      expect(setCookie).toContain("submission-success");
    });
  });

  describe("POST /projects/:id/delete", () => {
    test("redirects unauthenticated users to login", async () => {
      const request = createBunRequest<"/projects/:id/delete">(
        "http://localhost:3000/projects/42/delete",
        {
          method: "POST",
          headers: { Origin: "http://localhost:3000" },
          body: new FormData(),
        },
        { id: "42" },
      );

      const response = await projects.destroy(request);

      expect(mockDeleteProject).not.toHaveBeenCalled();
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/login");
    });

    test("rejects request without CSRF token", async () => {
      const sessionId = await createTestSession();
      const cookieHeader = `session_id=${sessionId}`;

      const request = createBunRequest<"/projects/:id/delete">(
        "http://localhost:3000/projects/42/delete",
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

      const response = await projects.destroy(request);

      expect(mockDeleteProject).not.toHaveBeenCalled();
      expect(response.status).toBe(403);
      expect(await response.text()).toBe("Invalid CSRF token");
    });

    test("deletes project with valid authentication and CSRF token", async () => {
      const sessionId = await createTestSession();
      const cookieHeader = `session_id=${sessionId}`;
      const csrfToken = await createCsrfToken(
        sessionId,
        "POST",
        "/projects/42/delete",
      );

      mockDeleteProject.mockResolvedValue(true);

      const mockFormData = new FormData();
      mockFormData.append("_csrf", csrfToken);

      const request = createBunRequest<"/projects/:id/delete">(
        "http://localhost:3000/projects/42/delete",
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

      const response = await projects.destroy(request);

      expect(response.status).toBe(303);
      expect(mockDeleteProject).toHaveBeenCalledWith(42);
      expect(response.headers.get("location")).toBe("/projects");

      const setCookie = findSetCookie(request, "flash_state");
      expect(setCookie).toBeDefined();
      expect(setCookie).toContain("deletion-success");
    });

    test("redirects without error when project not found", async () => {
      const sessionId = await createTestSession();
      const cookieHeader = `session_id=${sessionId}`;
      const csrfToken = await createCsrfToken(
        sessionId,
        "POST",
        "/projects/999/delete",
      );

      mockDeleteProject.mockResolvedValue(false);

      const mockFormData = new FormData();
      mockFormData.append("_csrf", csrfToken);

      const request = createBunRequest<"/projects/:id/delete">(
        "http://localhost:3000/projects/999/delete",
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

      const response = await projects.destroy(request);

      expect(mockDeleteProject).toHaveBeenCalledWith(999);
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/projects");
    });

    test("redirects when id is not a valid number", async () => {
      const sessionId = await createTestSession();
      const cookieHeader = `session_id=${sessionId}`;
      const csrfToken = await createCsrfToken(
        sessionId,
        "POST",
        "/projects/invalid/delete",
      );

      const mockFormData = new FormData();
      mockFormData.append("_csrf", csrfToken);

      const request = createBunRequest<"/projects/:id/delete">(
        "http://localhost:3000/projects/invalid/delete",
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

      const response = await projects.destroy(request);

      expect(mockDeleteProject).not.toHaveBeenCalled();
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/projects");
    });
  });
});
