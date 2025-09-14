import type { SQL } from "bun";

/**
 * Clean up test data between tests
 * Truncates all tables to provide test isolation
 *
 * @param db - The database connection to use (should be the mocked testDb from each test file)
 */
export const cleanupTestData = async (db: SQL): Promise<void> => {
  await db`TRUNCATE TABLE user_tokens CASCADE`;
  await db`TRUNCATE TABLE sessions CASCADE`;
  await db`TRUNCATE TABLE users CASCADE`;
  await db`TRUNCATE TABLE example CASCADE`;

  try {
    await db`ALTER SEQUENCE example_id_seq RESTART WITH 1`;
  } catch {}
};

/**
 * Seed the database with test data for example table
 *
 * @param db - The database connection to use (should be the mocked testDb from each test file)
 */
export const seedTestData = async (db: SQL): Promise<void> => {
  await db`INSERT INTO example (name) VALUES (${"Test Example 1"})`;
  await db`INSERT INTO example (name) VALUES (${"Test Example 2"})`;
  await db`INSERT INTO example (name) VALUES (${"Test Example 3"})`;
};
