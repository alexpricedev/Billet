import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { clearRateLimitLog } from "../../middleware/rate-limit";
import type { Project, ProjectPage } from "../../services/project";
import { createMockProject } from "../../test-utils/factories";
import { createMockRequest, expectJsonError } from "../../test-utils/setup";

// Mock the project service
const mockGetProjectPage = mock(
  async (): Promise<ProjectPage> => ({ projects: [], total: 0 }),
);
const mockGetProjectById = mock(async (): Promise<Project | null> => null);
const mockCreateProject = mock(
  async (): Promise<Project> => createMockProject(),
);
const mockUpdateProject = mock(async (): Promise<Project | null> => null);
const mockDeleteProject = mock(async (): Promise<boolean> => false);

mock.module("../../services/project", () => ({
  getProjectPage: mockGetProjectPage,
  getProjectById: mockGetProjectById,
  createProject: mockCreateProject,
  updateProject: mockUpdateProject,
  deleteProject: mockDeleteProject,
}));

// Import after mocking
import { projectsApi } from "./projects";

describe("Projects API", () => {
  afterAll(() => {
    mock.restore();
  });

  beforeEach(() => {
    // Reset all mocks
    mockGetProjectPage.mockClear();
    mockGetProjectById.mockClear();
    mockCreateProject.mockClear();
    mockUpdateProject.mockClear();
    mockDeleteProject.mockClear();
    // The rate-limit log is module state shared by every test in this file.
    clearRateLimitLog();
  });

  describe("GET /api/projects", () => {
    test("returns a page of projects with the total", async () => {
      const mockProjects = [
        createMockProject({ id: 1, title: "Project 1" }),
        createMockProject({ id: 2, title: "Project 2" }),
      ];
      mockGetProjectPage.mockResolvedValue({
        projects: mockProjects,
        total: 2,
      });

      const request = createMockRequest("http://localhost:3000/api/projects");
      const response = await projectsApi.index(request);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );

      const data = await response.json();
      expect(data).toEqual({
        data: mockProjects,
        pagination: { total: 2, limit: 25, offset: 0 },
      });
      expect(mockGetProjectPage).toHaveBeenCalledWith(25, 0);
    });

    test("honours limit and offset", async () => {
      mockGetProjectPage.mockResolvedValue({ projects: [], total: 0 });

      const request = createMockRequest(
        "http://localhost:3000/api/projects?limit=5&offset=10",
      );
      const response = await projectsApi.index(request);

      expect(response.status).toBe(200);
      expect(mockGetProjectPage).toHaveBeenCalledWith(5, 10);
      const data = (await response.json()) as { pagination: unknown };
      expect(data.pagination).toEqual({ total: 0, limit: 5, offset: 10 });
    });

    test("rejects a limit above the maximum rather than clamping it", async () => {
      const request = createMockRequest(
        "http://localhost:3000/api/projects?limit=5000",
      );
      const response = await projectsApi.index(request);

      await expectJsonError(response, 400, "invalid_limit");
      expect(mockGetProjectPage).not.toHaveBeenCalled();
    });

    test.each([["limit=0"], ["limit=abc"], ["limit=-1"], ["limit=1.5"]])(
      "rejects %s",
      async (query) => {
        const response = await projectsApi.index(
          createMockRequest(`http://localhost:3000/api/projects?${query}`),
        );

        await expectJsonError(response, 400, "invalid_limit");
      },
    );

    test("rejects a non-numeric offset", async () => {
      const response = await projectsApi.index(
        createMockRequest("http://localhost:3000/api/projects?offset=abc"),
      );

      await expectJsonError(response, 400, "invalid_offset");
    });

    test("returns 429 once the per-IP read limit is exceeded", async () => {
      const send = () =>
        projectsApi.index(
          createMockRequest("http://localhost:3000/api/projects"),
        );

      for (let i = 0; i < 60; i++) {
        expect((await send()).status).toBe(200);
      }

      const throttled = await send();
      await expectJsonError(throttled, 429, "rate_limited");
      expect(throttled.headers.get("Retry-After")).toBeTruthy();
    });
  });

  describe("GET /api/projects/:id", () => {
    test("returns project when found", async () => {
      const mockProject = createMockProject({ id: 1, title: "Test Project" });
      mockGetProjectById.mockResolvedValue(mockProject);

      const request = createMockRequest("http://localhost:3000/api/projects/1");
      const response = await projectsApi.show(request);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );

      const data = await response.json();
      expect(data).toEqual({ data: mockProject });
      expect(mockGetProjectById).toHaveBeenCalledWith(1);
    });

    test("returns a JSON 404 when project not found", async () => {
      mockGetProjectById.mockResolvedValue(null);

      const request = createMockRequest(
        "http://localhost:3000/api/projects/999",
      );
      const response = await projectsApi.show(request);

      await expectJsonError(response, 404, "not_found");
      expect(mockGetProjectById).toHaveBeenCalledWith(999);
    });

    test.each([["invalid"], ["0"], ["-1"], ["1.5"], ["12abc"], ["9999999999"]])(
      "rejects id %s without querying the database",
      async (id) => {
        const response = await projectsApi.show(
          createMockRequest(`http://localhost:3000/api/projects/${id}`),
        );

        await expectJsonError(response, 400, "invalid_id");
        expect(mockGetProjectById).not.toHaveBeenCalled();
      },
    );
  });

  describe("POST /api/projects", () => {
    test("creates and returns new project", async () => {
      const newProject = createMockProject({ id: 1, title: "New Project" });
      mockCreateProject.mockResolvedValue(newProject);

      const request = createMockRequest(
        "http://localhost:3000/api/projects",
        "POST",
        { title: "New Project" },
      );
      const response = await projectsApi.create(request);

      expect(response.status).toBe(201);
      expect(response.headers.get("Location")).toBe("/api/projects/1");

      const data = await response.json();
      expect(data).toEqual({ data: newProject });
      expect(mockCreateProject).toHaveBeenCalledWith("New Project", null);
    });

    test("trims the title", async () => {
      mockCreateProject.mockResolvedValue(createMockProject());

      await projectsApi.create(
        createMockRequest("http://localhost:3000/api/projects", "POST", {
          title: "  Padded  ",
        }),
      );

      expect(mockCreateProject).toHaveBeenCalledWith("Padded", null);
    });

    test("rejects a body that is not JSON with 400, not a 500", async () => {
      const request = createMockRequest(
        "http://localhost:3000/api/projects",
        "POST",
        "{ not json",
      );
      const response = await projectsApi.create(request);

      await expectJsonError(response, 400, "invalid_json");
      expect(mockCreateProject).not.toHaveBeenCalled();
    });

    test("rejects a non-JSON Content-Type with 415", async () => {
      const request = createMockRequest(
        "http://localhost:3000/api/projects",
        "POST",
        "title=New",
        { "Content-Type": "application/x-www-form-urlencoded" },
      );
      const response = await projectsApi.create(request);

      await expectJsonError(response, 415, "unsupported_media_type");
      expect(response.headers.get("Accept")).toBe("application/json");
      expect(mockCreateProject).not.toHaveBeenCalled();
    });

    test("accepts a +json structured-suffix media type", async () => {
      mockCreateProject.mockResolvedValue(createMockProject());

      const request = createMockRequest(
        "http://localhost:3000/api/projects",
        "POST",
        { title: "Vendor" },
        { "Content-Type": "application/vnd.billet.v1+json; charset=utf-8" },
      );
      const response = await projectsApi.create(request);

      expect(response.status).toBe(201);
    });

    test.each([
      ["a JSON array", "[]"],
      ["a JSON string", '"nope"'],
      ["null", "null"],
    ])("rejects %s as a body", async (_label, body) => {
      const response = await projectsApi.create(
        createMockRequest("http://localhost:3000/api/projects", "POST", body),
      );

      await expectJsonError(response, 400, "invalid_body");
      expect(mockCreateProject).not.toHaveBeenCalled();
    });

    test.each([
      ["a missing title", {}],
      ["a blank title", { title: "   " }],
      ["a non-string title", { title: 42 }],
    ])("rejects %s with field-level detail", async (_label, body) => {
      const response = await projectsApi.create(
        createMockRequest("http://localhost:3000/api/projects", "POST", body),
      );

      const parsed = await expectJsonError(response, 400, "invalid_body");
      expect(parsed.error.fields?.title).toBeTruthy();
      expect(mockCreateProject).not.toHaveBeenCalled();
    });

    test("returns 429 once the per-IP write limit is exceeded", async () => {
      mockCreateProject.mockResolvedValue(createMockProject());
      const send = () =>
        projectsApi.create(
          createMockRequest("http://localhost:3000/api/projects", "POST", {
            title: "Spam",
          }),
        );

      for (let i = 0; i < 20; i++) {
        expect((await send()).status).toBe(201);
      }

      await expectJsonError(await send(), 429, "rate_limited");
    });
  });

  describe("PUT /api/projects/:id", () => {
    test("updates and returns project when found", async () => {
      const updatedProject = createMockProject({
        id: 1,
        title: "Updated Project",
      });
      mockUpdateProject.mockResolvedValue(updatedProject);

      const request = createMockRequest(
        "http://localhost:3000/api/projects/1",
        "PUT",
        { title: "Updated Project" },
      );
      const response = await projectsApi.update(request);

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toEqual({ data: updatedProject });
      expect(mockUpdateProject).toHaveBeenCalledWith(1, "Updated Project");
    });

    test("returns a JSON 404 when project not found", async () => {
      mockUpdateProject.mockResolvedValue(null);

      const request = createMockRequest(
        "http://localhost:3000/api/projects/999",
        "PUT",
        { title: "Updated Project" },
      );
      const response = await projectsApi.update(request);

      await expectJsonError(response, 404, "not_found");
      expect(mockUpdateProject).toHaveBeenCalledWith(999, "Updated Project");
    });

    test("checks the id before reading the body", async () => {
      const response = await projectsApi.update(
        createMockRequest(
          "http://localhost:3000/api/projects/invalid",
          "PUT",
          "{ not json",
        ),
      );

      await expectJsonError(response, 400, "invalid_id");
      expect(mockUpdateProject).not.toHaveBeenCalled();
    });

    test("rejects a missing title", async () => {
      const response = await projectsApi.update(
        createMockRequest("http://localhost:3000/api/projects/1", "PUT", {}),
      );

      await expectJsonError(response, 400, "invalid_body");
      expect(mockUpdateProject).not.toHaveBeenCalled();
    });
  });

  describe("DELETE /api/projects/:id", () => {
    test("deletes project and returns 204", async () => {
      mockDeleteProject.mockResolvedValue(true);

      const request = createMockRequest(
        "http://localhost:3000/api/projects/1",
        "DELETE",
      );
      const response = await projectsApi.destroy(request);

      expect(response.status).toBe(204);
      const text = await response.text();
      expect(text).toBe("");
      expect(mockDeleteProject).toHaveBeenCalledWith(1);
    });

    test("returns a JSON 404 when project not found", async () => {
      mockDeleteProject.mockResolvedValue(false);

      const request = createMockRequest(
        "http://localhost:3000/api/projects/999",
        "DELETE",
      );
      const response = await projectsApi.destroy(request);

      await expectJsonError(response, 404, "not_found");
      expect(mockDeleteProject).toHaveBeenCalledWith(999);
    });

    test("rejects an invalid id without querying the database", async () => {
      const response = await projectsApi.destroy(
        createMockRequest(
          "http://localhost:3000/api/projects/invalid",
          "DELETE",
        ),
      );

      await expectJsonError(response, 400, "invalid_id");
      expect(mockDeleteProject).not.toHaveBeenCalled();
    });
  });
});
