import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { testDatabase } from "../test-utils/database";
import { cleanupTestData, seedTestData } from "../test-utils/helpers";

const connection = testDatabase();

// Mock the database module before importing the service
mock.module("./database", () => ({
  get db() {
    return connection;
  },
}));

import { db } from "./database";
import {
  createTodo,
  deleteTodo,
  getTodoById,
  getTodoPage,
  getTodos,
  toggleTodo,
  updateTodo,
} from "./todo";

describe("Todo Service with PostgreSQL", () => {
  beforeEach(async () => {
    await cleanupTestData(db);
  });

  afterAll(async () => {
    await connection.end();
    mock.restore();
  });

  describe("getTodos", () => {
    test("returns empty array when no todos exist", async () => {
      expect(await getTodos()).toEqual([]);
    });

    test("returns all todos ordered by id", async () => {
      await seedTestData(db);

      const result = await getTodos();
      expect(result).toHaveLength(3);
      expect(result.map((todo) => todo.title)).toEqual([
        "Test Todo 1",
        "Test Todo 2",
        "Test Todo 3",
      ]);
      expect(result[0].id).toBeLessThan(result[1].id);
      expect(result[1].id).toBeLessThan(result[2].id);
    });

    test("returns created_by and completion state", async () => {
      await seedTestData(db);

      const result = await getTodos();
      expect(result[0].created_by).toBe("alice@example.com");
      expect(result[1].created_by).toBeNull();
      expect(result[0].completed_at).toBeNull();
      expect(result[2].completed_at).toBeInstanceOf(Date);
    });
  });

  describe("getTodoPage", () => {
    test("returns a page and the total across all pages", async () => {
      await seedTestData(db);

      const page = await getTodoPage(2, 1);
      expect(page.total).toBe(3);
      expect(page.todos.map((todo) => todo.title)).toEqual([
        "Test Todo 2",
        "Test Todo 3",
      ]);
    });

    test("still reports the total on the empty page past the end", async () => {
      await seedTestData(db);

      const page = await getTodoPage(10, 10);
      expect(page.todos).toEqual([]);
      expect(page.total).toBe(3);
    });
  });

  describe("getTodoById", () => {
    test("returns the todo when found", async () => {
      await seedTestData(db);
      const [first] = await getTodos();

      const result = await getTodoById(first.id);
      expect(result).toEqual(first);
    });

    test("returns null when not found", async () => {
      expect(await getTodoById(9999)).toBeNull();
    });
  });

  describe("createTodo", () => {
    test("creates an open todo with an auto-increment id", async () => {
      const result = await createTodo("New Test Todo");

      expect(typeof result.id).toBe("number");
      expect(result.id).toBeGreaterThan(0);
      expect(result.title).toBe("New Test Todo");
      expect(result.completed_at).toBeNull();
      expect(result.created_by).toBeNull();
    });

    test("records created_by", async () => {
      const result = await createTodo("Auth Todo", "user@example.com");
      expect(result.created_by).toBe("user@example.com");
    });

    test("created todo is retrievable", async () => {
      const created = await createTodo("Retrievable");
      expect(await getTodoById(created.id)).toEqual(created);
    });
  });

  describe("updateTodo", () => {
    test("renames and keeps the completion state when completed is omitted", async () => {
      const created = await createTodo("Original", "user@example.com");

      const updated = await updateTodo(created.id, "Updated");

      expect(updated?.id).toBe(created.id);
      expect(updated?.title).toBe("Updated");
      expect(updated?.completed_at).toBeNull();
      expect(updated?.created_by).toBe("user@example.com");
    });

    test("completed: true stamps completed_at once", async () => {
      const created = await createTodo("Finish");

      const done = await updateTodo(created.id, "Finish", true);
      expect(done?.completed_at).toBeInstanceOf(Date);

      // Completing an already-complete todo doesn't move the time.
      const again = await updateTodo(created.id, "Finish", true);
      expect(again?.completed_at?.getTime()).toBe(
        done?.completed_at?.getTime(),
      );
    });

    test("completed: false clears completed_at", async () => {
      const created = await createTodo("Undo me");
      await updateTodo(created.id, "Undo me", true);

      const reopened = await updateTodo(created.id, "Undo me", false);
      expect(reopened?.completed_at).toBeNull();
    });

    test("returns null for a missing todo", async () => {
      expect(await updateTodo(9999, "Updated")).toBeNull();
    });
  });

  describe("toggleTodo", () => {
    test("flips open to done and back", async () => {
      const created = await createTodo("Flip");

      const done = await toggleTodo(created.id);
      expect(done?.completed_at).toBeInstanceOf(Date);

      const reopened = await toggleTodo(created.id);
      expect(reopened?.completed_at).toBeNull();
    });

    test("returns null for a missing todo", async () => {
      expect(await toggleTodo(9999)).toBeNull();
    });
  });

  describe("deleteTodo", () => {
    test("deletes an existing todo", async () => {
      const created = await createTodo("To Delete");

      expect(await deleteTodo(created.id)).toBe(true);
      expect(await getTodoById(created.id)).toBeNull();
    });

    test("returns false when nothing was deleted", async () => {
      expect(await deleteTodo(9999)).toBe(false);
    });

    test("removes the todo from the list", async () => {
      await seedTestData(db);
      const [first, ...rest] = await getTodos();

      await deleteTodo(first.id);

      expect(await getTodos()).toEqual(rest);
    });
  });
});
