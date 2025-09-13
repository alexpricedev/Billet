import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { TestDatabase } from "../test-utils/test-db";
import { initTestDb, seedTestData } from "../test-utils/test-db";
import {
  createExample,
  deleteExample,
  getExampleById,
  getExamples,
  updateExample,
} from "./example";

describe("Example Service with pg-mem", () => {
  let testDb: TestDatabase;
  let backup: TestDatabase["backup"];

  beforeAll(async () => {
    testDb = await initTestDb();
    backup = testDb.backup;

    // Mock the database module to use our test database
    mock.module("./database", () => ({
      db: testDb.sql,
    }));
  });

  beforeEach(() => {
    // Restore to clean state before each test
    backup.restore();
  });

  describe("getExamples", () => {
    test("returns empty array when no examples exist", async () => {
      const result = await getExamples();
      expect(result).toEqual([]);
    });

    test("returns all examples ordered by id", async () => {
      // Seed some test data
      await seedTestData(testDb.sql);

      const result = await getExamples();
      expect(result).toHaveLength(3);
      expect(result[0].name).toBe("Test Example 1");
      expect(result[1].name).toBe("Test Example 2");
      expect(result[2].name).toBe("Test Example 3");

      // Should be ordered by id
      expect(result[0].id).toBeLessThan(result[1].id);
      expect(result[1].id).toBeLessThan(result[2].id);
    });
  });

  describe("getExampleById", () => {
    test("returns example when found", async () => {
      await seedTestData(testDb.sql);
      const examples = await getExamples();
      const firstId = examples[0].id;

      const result = await getExampleById(firstId);

      expect(result).not.toBeNull();
      expect(result?.id).toBe(firstId);
      expect(result?.name).toBe("Test Example 1");
    });

    test("returns null when example not found", async () => {
      const result = await getExampleById(9999);
      expect(result).toBeNull();
    });
  });

  describe("createExample", () => {
    test("creates new example with auto-increment id", async () => {
      const result = await createExample("New Test Example");

      expect(result.id).toBeDefined();
      expect(result.name).toBe("New Test Example");
      expect(typeof result.id).toBe("number");
      expect(result.id).toBeGreaterThan(0);
    });

    test("creates multiple examples with different ids", async () => {
      const result1 = await createExample("Example 1");
      const result2 = await createExample("Example 2");

      expect(result1.id).not.toBe(result2.id);
      expect(result1.name).toBe("Example 1");
      expect(result2.name).toBe("Example 2");
    });

    test("created example is retrievable", async () => {
      const created = await createExample("Retrievable Example");
      const retrieved = await getExampleById(created.id);

      expect(retrieved).toEqual(created);
    });
  });

  describe("updateExample", () => {
    test("updates existing example", async () => {
      const created = await createExample("Original Name");

      const updated = await updateExample(created.id, "Updated Name");

      expect(updated).not.toBeNull();
      expect(updated?.id).toBe(created.id);
      expect(updated?.name).toBe("Updated Name");
    });

    test("returns null when updating non-existent example", async () => {
      const result = await updateExample(9999, "Updated Name");
      expect(result).toBeNull();
    });

    test("updated example persists in database", async () => {
      const created = await createExample("Original");
      await updateExample(created.id, "Modified");

      const retrieved = await getExampleById(created.id);
      expect(retrieved?.name).toBe("Modified");
    });
  });

  describe("deleteExample", () => {
    test("deletes existing example", async () => {
      const created = await createExample("To Delete");

      const deleteResult = await deleteExample(created.id);
      expect(deleteResult).toBe(true);

      // Verify it's gone
      const retrieved = await getExampleById(created.id);
      expect(retrieved).toBeNull();
    });

    test("returns false when deleting non-existent example", async () => {
      const result = await deleteExample(9999);
      expect(result).toBe(false);
    });

    test("deleted example is removed from list", async () => {
      await seedTestData(testDb.sql);
      const examples = await getExamples();
      const initialCount = examples.length;

      const deleted = await deleteExample(examples[0].id);
      expect(deleted).toBe(true);

      const remainingExamples = await getExamples();
      expect(remainingExamples).toHaveLength(initialCount - 1);
      expect(
        remainingExamples.find((e) => e.id === examples[0].id),
      ).toBeUndefined();
    });
  });

  describe("integration scenarios", () => {
    test("complete CRUD workflow", async () => {
      // Create
      const created = await createExample("CRUD Test");
      expect(created.id).toBeDefined();

      // Read
      const read = await getExampleById(created.id);
      expect(read).toEqual(created);

      // Update
      const updated = await updateExample(created.id, "CRUD Test Updated");
      expect(updated?.name).toBe("CRUD Test Updated");

      // Delete
      const deleted = await deleteExample(created.id);
      expect(deleted).toBe(true);

      // Verify deletion
      const notFound = await getExampleById(created.id);
      expect(notFound).toBeNull();
    });
  });
});
