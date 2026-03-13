import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Project } from "../../services/project";
import { createMockProject } from "../../test-utils/factories";
import { createMockRequest } from "../../test-utils/setup";

// Mock the project service
const mockGetProjects = mock(async (): Promise<Project[]> => []);
const mockGetProjectById = mock(async (): Promise<Project | null> => null);
const mockCreateProject = mock(
  async (): Promise<Project> => createMockProject(),
);
const mockUpdateProject = mock(async (): Promise<Project | null> => null);
const mockDeleteProject = mock(async (): Promise<boolean> => false);

mock.module("../../services/project", () => ({
  getProjects: mockGetProjects,
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
    mockGetProjects.mockClear();
    mockGetProjectById.mockClear();
    mockCreateProject.mockClear();
    mockUpdateProject.mockClear();
    mockDeleteProject.mockClear();
  });

  describe("GET /api/projects", () => {
    test("returns list of projects", async () => {
      const mockProjects = [
        createMockProject({ id: 1, title: "Project 1" }),
        createMockProject({ id: 2, title: "Project 2" }),
      ];
      mockGetProjects.mockResolvedValue(mockProjects);

      const request = createMockRequest("http://localhost:3000/api/projects");
      const response = await projectsApi.index(request);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );

      const data = await response.json();
      expect(data).toEqual(mockProjects);
      expect(mockGetProjects).toHaveBeenCalled();
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
      expect(data).toEqual(mockProject);
      expect(mockGetProjectById).toHaveBeenCalledWith(1);
    });

    test("returns 404 when project not found", async () => {
      mockGetProjectById.mockResolvedValue(null);

      const request = createMockRequest(
        "http://localhost:3000/api/projects/999",
      );
      const response = await projectsApi.show(request);

      expect(response.status).toBe(404);
      const text = await response.text();
      expect(text).toBe("Project not found");
      expect(mockGetProjectById).toHaveBeenCalledWith(999);
    });

    test("handles invalid ID parameter", async () => {
      const request = createMockRequest(
        "http://localhost:3000/api/projects/invalid",
      );
      await projectsApi.show(request);

      // parseInt("invalid") returns NaN, and Number.parseInt with fallback returns 0
      expect(mockGetProjectById).toHaveBeenCalledWith(Number.NaN);
    });
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
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );

      const data = await response.json();
      expect(data).toEqual(newProject);
      expect(mockCreateProject).toHaveBeenCalledWith("New Project", null);
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
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );

      const data = await response.json();
      expect(data).toEqual(updatedProject);
      expect(mockUpdateProject).toHaveBeenCalledWith(1, "Updated Project");
    });

    test("returns 404 when project not found", async () => {
      mockUpdateProject.mockResolvedValue(null);

      const request = createMockRequest(
        "http://localhost:3000/api/projects/999",
        "PUT",
        { title: "Updated Project" },
      );
      const response = await projectsApi.update(request);

      expect(response.status).toBe(404);
      const text = await response.text();
      expect(text).toBe("Project not found");
      expect(mockUpdateProject).toHaveBeenCalledWith(999, "Updated Project");
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

    test("returns 404 when project not found", async () => {
      mockDeleteProject.mockResolvedValue(false);

      const request = createMockRequest(
        "http://localhost:3000/api/projects/999",
        "DELETE",
      );
      const response = await projectsApi.destroy(request);

      expect(response.status).toBe(404);
      const text = await response.text();
      expect(text).toBe("Project not found");
      expect(mockDeleteProject).toHaveBeenCalledWith(999);
    });
  });
});
