import { readdirSync } from "node:fs";
import { join } from "node:path";
import { db } from "../services/database";

export type Migration = {
  id: string;
  name: string;
  applied_at: Date;
};

/**
 * Ensure migrations table exists for tracking applied migrations
 */
export const ensureMigrationsTable = async (): Promise<void> => {
  await db`
    CREATE TABLE IF NOT EXISTS migrations (
      id VARCHAR(255) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;
};

/**
 * Get list of migrations already applied to database
 */
export const getAppliedMigrations = async (): Promise<Migration[]> => {
  await ensureMigrationsTable();
  const results =
    await db`SELECT id, name, applied_at FROM migrations ORDER BY id`;
  return results as Migration[];
};

/**
 * Record migration as applied in migrations table
 */
export const recordMigration = async (
  id: string,
  name: string,
): Promise<void> => {
  await db`INSERT INTO migrations (id, name) VALUES (${id}, ${name})`;
};

/**
 * Remove migration record from migrations table
 */
export const removeMigration = async (id: string): Promise<void> => {
  await db`DELETE FROM migrations WHERE id = ${id}`;
};

/**
 * Get list of migration files that haven't been applied yet
 */
export const getPendingMigrations = async (): Promise<string[]> => {
  const migrationsDir = join(process.cwd(), "src/server/database/migrations");
  const migrationFiles = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".ts"))
    .sort();

  const appliedMigrations = await getAppliedMigrations();
  const appliedIds = new Set(appliedMigrations.map((m) => m.id));

  return migrationFiles.filter((file) => {
    const id = file.replace(".ts", "");
    return !appliedIds.has(id);
  });
};

/**
 * Run a single migration file and record it as applied
 */
export const runMigration = async (filename: string): Promise<void> => {
  const migrationPath = join(
    process.cwd(),
    "src/server/database/migrations",
    filename,
  );
  const migration = await import(migrationPath);

  if (typeof migration.up !== "function") {
    throw new Error(`Migration ${filename} does not export an 'up' function`);
  }

  await migration.up(db);

  const id = filename.replace(".ts", "");
  const name = filename.replace(/^\d+_/, "").replace(".ts", "");
  await recordMigration(id, name);

  console.log(`Applied migration: ${filename}`);
};

/**
 * Run all pending migration files in order
 */
export const runMigrations = async (): Promise<void> => {
  const pendingMigrations = await getPendingMigrations();

  if (pendingMigrations.length === 0) {
    console.log("No pending migrations");
    return;
  }

  console.log(`Running ${pendingMigrations.length} pending migrations...`);

  for (const migration of pendingMigrations) {
    await runMigration(migration);
  }

  console.log("All migrations completed");
};

/**
 * Rollback a single migration and remove it from applied migrations
 */
export const rollbackMigration = async (filename: string): Promise<void> => {
  const migrationPath = join(
    process.cwd(),
    "src/server/database/migrations",
    filename,
  );
  const migration = await import(migrationPath);

  if (typeof migration.down !== "function") {
    throw new Error(`Migration ${filename} does not export a 'down' function`);
  }

  await migration.down(db);

  const id = filename.replace(".ts", "");
  await removeMigration(id);

  console.log(`Rolled back migration: ${filename}`);
};

/**
 * Rollback the most recently applied migration
 */
export const rollbackLastMigration = async (): Promise<void> => {
  const appliedMigrations = await getAppliedMigrations();

  if (appliedMigrations.length === 0) {
    console.log("No migrations to rollback");
    return;
  }

  const lastMigration = appliedMigrations[appliedMigrations.length - 1];
  const filename = `${lastMigration.id}.ts`;

  await rollbackMigration(filename);
};
