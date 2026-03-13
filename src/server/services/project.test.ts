import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { SQL } from "bun";
import { cleanupTestData, seedTestData } from "../test-utils/helpers";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for tests");
}
const connection = new SQL(process.env.DATABASE_URL);

// Mock the database module before importing the service
mock.module("./database", () => ({
  get db() {
    return connection;
  },
}));

import { db } from "./database";
import {
  createProject,
  deleteProject,
  getProjectById,
  getProjects,
  updateProject,
} from "./project";

describe("Project Service with PostgreSQL", () => {
  beforeEach(async () => {
    await cleanupTestData(db);
  });

  afterAll(async () => {
    await connection.end();
    mock.restore();
  });

  describe("getProjects", () => {
    test("returns empty array when no projects exist", async () => {
      const result = await getProjects();
      expect(result).toEqual([]);
    });

    test("returns all projects ordered by id", async () => {
      await seedTestData(db);

      const result = await getProjects();
      expect(result).toHaveLength(3);
      expect(result[0].title).toBe("Test Project 1");
      expect(result[1].title).toBe("Test Project 2");
      expect(result[2].title).toBe("Test Project 3");

      expect(result[0].id).toBeLessThan(result[1].id);
      expect(result[1].id).toBeLessThan(result[2].id);
    });

    test("returns created_by values", async () => {
      await seedTestData(db);

      const result = await getProjects();
      expect(result[0].created_by).toBe("alice@example.com");
      expect(result[1].created_by).toBeNull();
      expect(result[2].created_by).toBe("bob@example.com");
    });
  });

  describe("getProjectById", () => {
    test("returns project when found", async () => {
      await seedTestData(db);
      const projects = await getProjects();
      const firstId = projects[0].id;

      const result = await getProjectById(firstId);

      expect(result).not.toBeNull();
      expect(result?.id).toBe(firstId);
      expect(result?.title).toBe("Test Project 1");
      expect(result?.created_by).toBe("alice@example.com");
    });

    test("returns null when project not found", async () => {
      const result = await getProjectById(9999);
      expect(result).toBeNull();
    });
  });

  describe("createProject", () => {
    test("creates new project with auto-increment id", async () => {
      const result = await createProject("New Test Project");

      expect(result.id).toBeDefined();
      expect(result.title).toBe("New Test Project");
      expect(result.created_by).toBeNull();
      expect(typeof result.id).toBe("number");
      expect(result.id).toBeGreaterThan(0);
    });

    test("creates project with created_by", async () => {
      const result = await createProject("Auth Project", "user@example.com");

      expect(result.title).toBe("Auth Project");
      expect(result.created_by).toBe("user@example.com");
    });

    test("creates project with null created_by for guests", async () => {
      const result = await createProject("Guest Project", null);

      expect(result.title).toBe("Guest Project");
      expect(result.created_by).toBeNull();
    });

    test("creates multiple projects with different ids", async () => {
      const result1 = await createProject("Project 1");
      const result2 = await createProject("Project 2");

      expect(result1.id).not.toBe(result2.id);
      expect(result1.title).toBe("Project 1");
      expect(result2.title).toBe("Project 2");
    });

    test("created project is retrievable", async () => {
      const created = await createProject("Retrievable Project");
      const retrieved = await getProjectById(created.id);

      expect(retrieved).toEqual(created);
    });
  });

  describe("updateProject", () => {
    test("updates existing project", async () => {
      const created = await createProject("Original Title");

      const updated = await updateProject(created.id, "Updated Title");

      expect(updated).not.toBeNull();
      expect(updated?.id).toBe(created.id);
      expect(updated?.title).toBe("Updated Title");
    });

    test("preserves created_by on update", async () => {
      const created = await createProject("Original", "user@example.com");
      const updated = await updateProject(created.id, "Updated");

      expect(updated?.created_by).toBe("user@example.com");
    });

    test("returns null when updating non-existent project", async () => {
      const result = await updateProject(9999, "Updated Title");
      expect(result).toBeNull();
    });

    test("updated project persists in database", async () => {
      const created = await createProject("Original");
      await updateProject(created.id, "Modified");

      const retrieved = await getProjectById(created.id);
      expect(retrieved?.title).toBe("Modified");
    });
  });

  describe("deleteProject", () => {
    test("deletes existing project", async () => {
      const created = await createProject("To Delete");

      const deleteResult = await deleteProject(created.id);
      expect(deleteResult).toBe(true);

      const retrieved = await getProjectById(created.id);
      expect(retrieved).toBeNull();
    });

    test("returns false when deleting non-existent project", async () => {
      const result = await deleteProject(9999);
      expect(result).toBe(false);
    });

    test("deleted project is removed from list", async () => {
      await seedTestData(db);
      const projects = await getProjects();
      const initialCount = projects.length;

      const deleted = await deleteProject(projects[0].id);
      expect(deleted).toBe(true);

      const remainingProjects = await getProjects();
      expect(remainingProjects).toHaveLength(initialCount - 1);
      expect(
        remainingProjects.find((e) => e.id === projects[0].id),
      ).toBeUndefined();
    });
  });

  describe("integration scenarios", () => {
    test("complete CRUD workflow", async () => {
      const created = await createProject("CRUD Test");
      expect(created.id).toBeDefined();

      const read = await getProjectById(created.id);
      expect(read).toEqual(created);

      const updated = await updateProject(created.id, "CRUD Test Updated");
      expect(updated?.title).toBe("CRUD Test Updated");

      const deleted = await deleteProject(created.id);
      expect(deleted).toBe(true);

      const notFound = await getProjectById(created.id);
      expect(notFound).toBeNull();
    });
  });
});
