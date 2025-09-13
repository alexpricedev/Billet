import { SQL } from "bun";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

// Create test database connection
// Since we're using --env-file=.env.test, DATABASE_URL points to the test database
const testDb = new SQL(process.env.DATABASE_URL);

/**
 * Clean up test data between tests
 * Truncates all tables to provide test isolation
 */
export const cleanupTestData = async (): Promise<void> => {
  // Truncate all tables in reverse dependency order to avoid FK constraint issues
  await testDb`TRUNCATE TABLE user_tokens CASCADE`;
  await testDb`TRUNCATE TABLE sessions CASCADE`;
  await testDb`TRUNCATE TABLE users CASCADE`;
  await testDb`TRUNCATE TABLE example CASCADE`;

  // Reset the auto-increment sequences
  try {
    await testDb`ALTER SEQUENCE example_id_seq RESTART WITH 1`;
  } catch {
    // Sequence might not exist, ignore error
  }
};

/**
 * Seed the database with test data
 */
export const seedTestData = async (): Promise<void> => {
  // Insert some example data
  await testDb`INSERT INTO example (name) VALUES (${"Test Example 1"})`;
  await testDb`INSERT INTO example (name) VALUES (${"Test Example 2"})`;
  await testDb`INSERT INTO example (name) VALUES (${"Test Example 3"})`;
};
