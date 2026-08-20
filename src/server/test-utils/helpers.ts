import type { SQL } from "bun";

/**
 * Clean up test data between tests
 * Truncates all tables to provide test isolation
 *
 * @param db - The database connection to use (should be the mocked testDb from each test file)
 */
export const cleanupTestData = async (db: SQL): Promise<void> => {
  /* One statement rather than seven, because every test in the suite calls this
     and the round trips add up — on CI each one waits on an fsync. Truncating
     the tables together also removes the ordering problem: a single TRUNCATE
     checks its foreign keys once, at the end.

     RESTART IDENTITY resets `project_id_seq`, which the project tests assert
     against by literal id. */
  await db`
    TRUNCATE TABLE
      organization_invites, organization_members, organizations,
      user_tokens, sessions, users,
      project
    RESTART IDENTITY CASCADE
  `;
};

/**
 * Seed the database with test data for project table
 *
 * @param db - The database connection to use (should be the mocked testDb from each test file)
 */
export const seedTestData = async (db: SQL): Promise<void> => {
  await db`INSERT INTO project (title, created_by) VALUES (${"Test Project 1"}, ${"alice@example.com"})`;
  await db`INSERT INTO project (title, created_by) VALUES (${"Test Project 2"}, ${null})`;
  await db`INSERT INTO project (title, created_by) VALUES (${"Test Project 3"}, ${"bob@example.com"})`;
};

/**
 * Generate a random email address for testing
 * Uses timestamp and random string to ensure uniqueness
 *
 * @param domain - Optional domain, defaults to "example.com"
 * @returns A unique email address for testing
 */
export const randomEmail = (domain = "example.com"): string => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `test-${timestamp}-${random}@${domain}`;
};
