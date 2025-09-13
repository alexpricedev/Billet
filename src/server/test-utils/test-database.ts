import { SQL } from "bun";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

/**
 * Test database connection using .env.test DATABASE_URL
 */
const testDb = new SQL(process.env.DATABASE_URL);

/**
 * Clean up test data between tests
 * Truncates all tables to provide test isolation
 */
export const cleanupTestData = async (): Promise<void> => {
  await testDb`TRUNCATE TABLE user_tokens CASCADE`;
  await testDb`TRUNCATE TABLE sessions CASCADE`;
  await testDb`TRUNCATE TABLE users CASCADE`;
  await testDb`TRUNCATE TABLE example CASCADE`;

  try {
    await testDb`ALTER SEQUENCE example_id_seq RESTART WITH 1`;
  } catch {}
};

/**
 * Seed the database with test data for example table
 */
export const seedTestData = async (): Promise<void> => {
  await testDb`INSERT INTO example (name) VALUES (${"Test Example 1"})`;
  await testDb`INSERT INTO example (name) VALUES (${"Test Example 2"})`;
  await testDb`INSERT INTO example (name) VALUES (${"Test Example 3"})`;
};
