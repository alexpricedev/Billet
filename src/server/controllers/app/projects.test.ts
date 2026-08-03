import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  setSystemTime,
  test,
} from "bun:test";
import { SQL } from "bun";
import { findOrCreateUser } from "../../services/auth";
import { createCsrfToken, TIME_WINDOW_MINUTES } from "../../services/csrf";
import type { Project } from "../../services/project";
import {
  createAuthenticatedSession,
  createGuestSession,
} from "../../services/sessions";
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

  afterEach(() => {
    setSystemTime();
  });

  afterAll(async () => {
    await connection.end();
    mock.restore();
  });

  const createTestSession = async () => {
    const user = await findOrCreateUser(randomEmail());
    return createAuthenticatedSession(user.id);
  };

  // Mint a token as if the page had rendered several windows ago: authentic,
  // but too stale to act on.
  const mintStaleToken = async (
    sessionId: string,
    path: string,
  ): Promise<string> => {
    setSystemTime(new Date(Date.now() - TIME_WINDOW_MINUTES * 3 * 60 * 1000));
    const token = await createCsrfToken(sessionId, "POST", path);
    setSystemTime();
    return token;
  };

  describe("GET /projects", () => {
    test("renders projects page with create form for guests", async () => {
      const guestSessionId = await createGuestSession();
      const mockProjectsList = [
        createMockProject({ id: 1, title: "Project 1" }),
        createMockProject({
          id: 2,
          title: "Project 2",
          created_by: "alice@example.com",
        }),
      ];
      mockGetProjects.mockResolvedValue(mockProjectsList);

      const request = createBunRequest("http://localhost:3000/projects", {
        headers: { Cookie: `session_id=${guestSessionId}` },
      });
      const response = await projects.index(request);
      const html = await response.text();

      expect(mockGetProjects).toHaveBeenCalled();
      expect(response.headers.get("content-type")).toBe("text/html");

      expect(html).toContain("CRUD");
      expect(html).toContain("Project 1");
      expect(html).toContain("Project 2");
      expect(html).toContain("Add Project");
      expect(html).toContain('name="_csrf"');
    });

    test("renders Created by column with email or Guest", async () => {
      const guestSessionId = await createGuestSession();
      const mockProjectsList = [
        createMockProject({
          id: 1,
          title: "Project 1",
          created_by: "alice@example.com",
        }),
        createMockProject({ id: 2, title: "Project 2", created_by: null }),
      ];
      mockGetProjects.mockResolvedValue(mockProjectsList);

      const request = createBunRequest("http://localhost:3000/projects", {
        headers: { Cookie: `session_id=${guestSessionId}` },
      });
      const response = await projects.index(request);
      const html = await response.text();

      expect(html).toContain("Created by");
      expect(html).toContain("User");
      expect(html).toContain("Guest");
    });

    test("renders projects page with form for authenticated users", async () => {
      const sessionId = await createTestSession();

      mockGetProjects.mockResolvedValue([]);

      const request = createBunRequest("http://localhost:3000/projects", {
        headers: { Cookie: `session_id=${sessionId}` },
      });
      const response = await projects.index(request);
      const html = await response.text();

      expect(html).toContain("CRUD");
      expect(html).toContain('name="_csrf"');
      expect(html).toContain("Add Project");
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
    test("guest can create project with valid CSRF token", async () => {
      const sessionId = await createGuestSession();
      const cookieHeader = `session_id=${sessionId}`;
      const csrfToken = await createCsrfToken(sessionId, "POST", "/projects");

      const mockFormData = new FormData();
      mockFormData.append("title", "Guest Project");
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

      expect(mockCreateProject).toHaveBeenCalledWith("Guest Project", null);
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/projects");
    });

    test("authenticated user creates project with email as created_by", async () => {
      const email = randomEmail();
      const user = await findOrCreateUser(email);
      const sessionId = await createAuthenticatedSession(user.id);
      const cookieHeader = `session_id=${sessionId}`;
      const csrfToken = await createCsrfToken(sessionId, "POST", "/projects");

      const mockFormData = new FormData();
      mockFormData.append("title", "Auth Project");
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

      expect(mockCreateProject).toHaveBeenCalledWith("Auth Project", email);
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/projects");

      const setCookie = findSetCookie(request, "flash_state");
      expect(setCookie).toBeDefined();
      expect(setCookie).toContain("submission-success");
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

      expect(mockCreateProject).toHaveBeenCalled();
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

      expect(mockCreateProject).toHaveBeenCalled();
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

  describe("CSRF expiry recovery", () => {
    test("create preserves the title and does not create the project", async () => {
      const sessionId = await createTestSession();
      const staleToken = await mintStaleToken(sessionId, "/projects");

      const mockFormData = new FormData();
      mockFormData.append("title", "My New Project");
      mockFormData.append("_csrf", staleToken);

      const request = createBunRequest("http://localhost:3000/projects", {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
          Cookie: `session_id=${sessionId}`,
        },
        body: mockFormData,
      });

      const response = await projects.create(request);

      expect(mockCreateProject).not.toHaveBeenCalled();
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/projects");

      const setCookie = findSetCookie(request, "flash_state");
      expect(setCookie).toContain("csrf-expired");
      expect(setCookie).toContain("My New Project");
    });

    test("destroy never deletes on a stale token", async () => {
      const sessionId = await createTestSession();
      const staleToken = await mintStaleToken(sessionId, "/projects/1/delete");

      const mockFormData = new FormData();
      mockFormData.append("_csrf", staleToken);

      const request = createBunRequest(
        "http://localhost:3000/projects/1/delete",
        {
          method: "POST",
          headers: {
            Origin: "http://localhost:3000",
            Cookie: `session_id=${sessionId}`,
          },
          body: mockFormData,
        },
        { id: "1" },
      );

      const response = await projects.destroy(request);

      // The load-bearing assertion: a destructive action must never be
      // replayed off a stale token.
      expect(mockDeleteProject).not.toHaveBeenCalled();
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/projects");
      expect(findSetCookie(request, "flash_state")).toContain(
        "delete-csrf-expired",
      );
    });

    test("renders the recovery warning and pre-fills the title", async () => {
      const sessionId = await createTestSession();
      mockGetProjects.mockResolvedValueOnce([]);

      const request = createBunRequest("http://localhost:3000/projects", {
        headers: { Cookie: `session_id=${sessionId}` },
      });

      const { setFlash } = stateHelpers<ProjectsState>();
      setFlash(request, { state: "csrf-expired", title: "My New Project" });

      const response = await projects.index(request);
      const html = await response.text();

      expect(html).toContain("Your session timed out");
      expect(html).toContain('value="My New Project"');
    });
  });
});
