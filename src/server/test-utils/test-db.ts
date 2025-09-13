import type { IBackup, IMemoryDb } from "pg-mem";
import { newDb } from "pg-mem";
import { createBunSqlAdapter } from "./pg-mem-adapter";

export interface TestDatabase {
  db: IMemoryDb;
  sql: (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<unknown[]>;
  backup: IBackup;
}

/**
 * Initialize an in-memory PostgreSQL database for testing
 * Applies migrations and returns a Bun SQL-compatible interface
 */
export const initTestDb = async (): Promise<TestDatabase> => {
  const db = newDb();

  // Run migrations to set up schema
  await runMigrations(db);

  // Create Bun SQL-compatible interface
  const sql = createBunSqlAdapter(db);

  return {
    db,
    sql,
    backup: db.backup(),
  };
};

/**
 * Apply database migrations from the migrations directory
 */
const runMigrations = async (db: IMemoryDb): Promise<void> => {
  // Apply initial migration - create example table
  await db.public.none(`
    CREATE TABLE IF NOT EXISTS example (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL
    )
  `);

  // Apply test table migration if needed
  await db.public.none(`
    CREATE TABLE IF NOT EXISTS test_table (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
};

/**
 * Seed the database with test data
 */
export const seedTestData = async (sql: TestDatabase["sql"]): Promise<void> => {
  // Insert some example data
  await sql`INSERT INTO example (name) VALUES (${"Test Example 1"})`;
  await sql`INSERT INTO example (name) VALUES (${"Test Example 2"})`;
  await sql`INSERT INTO example (name) VALUES (${"Test Example 3"})`;
};
