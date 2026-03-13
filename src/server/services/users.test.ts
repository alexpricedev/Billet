import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { SQL } from "bun";
import { cleanupTestData } from "../test-utils/helpers";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for tests");
}
const connection = new SQL(process.env.DATABASE_URL);

mock.module("./database", () => ({
  get db() {
    return connection;
  },
}));

import { db } from "./database";
import { getUsers } from "./users";

describe("Users Service", () => {
  beforeEach(async () => {
    await cleanupTestData(db);
  });

  afterAll(async () => {
    await connection.end();
    mock.restore();
  });

  test("returns empty array when no users exist", async () => {
    const result = await getUsers();
    expect(result).toEqual([]);
  });

  test("returns all users with expected fields", async () => {
    const userId1 = randomUUID();
    const userId2 = randomUUID();
    await db`INSERT INTO users (id, email, role) VALUES (${userId1}, 'alice@test.com', 'admin')`;
    await db`INSERT INTO users (id, email, role) VALUES (${userId2}, 'bob@test.com', 'user')`;

    const result = await getUsers();

    expect(result).toHaveLength(2);
    expect(result[0]).toHaveProperty("id");
    expect(result[0]).toHaveProperty("email");
    expect(result[0]).toHaveProperty("role");
    expect(result[0]).toHaveProperty("created_at");
  });

  test("returns users ordered by created_at descending (newest first)", async () => {
    const userId1 = randomUUID();
    const userId2 = randomUUID();
    await db`INSERT INTO users (id, email, role, created_at) VALUES (${userId1}, 'first@test.com', 'user', '2026-01-01')`;
    await db`INSERT INTO users (id, email, role, created_at) VALUES (${userId2}, 'second@test.com', 'admin', '2026-03-01')`;

    const result = await getUsers();

    expect(result[0].email).toBe("second@test.com");
    expect(result[1].email).toBe("first@test.com");
  });
});
