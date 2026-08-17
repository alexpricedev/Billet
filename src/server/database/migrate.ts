import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { SQL } from "bun";
import { db } from "../services/database";
import { log } from "../services/logger";
import { pluginMigrations } from "./plugin-migrations";

const MIGRATIONS_DIR = join(process.cwd(), "src/server/database/migrations");

export type Migration = {
  id: string;
  name: string;
  applied_at: Date;
};

/**
 * A migration resolved from either source — a file in `migrations/` or a
 * plugin package — reduced to the shape the runner actually needs.
 */
type ResolvedMigration = {
  id: string;
  name: string;
  up?: (db: SQL) => Promise<void>;
  down?: (db: SQL) => Promise<void>;
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
 * Every migration id this app knows about, in the order it must run.
 *
 * File migrations come first, plugin migrations last. Dependencies only point
 * one way — a plugin table may reference `users`, nothing in this app's own
 * schema references a plugin — so plugins building on a finished core schema is
 * the ordering that always works.
 */
export const getAllMigrationIds = (): string[] => {
  const fileIds = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".ts"))
    .sort()
    .map((file) => file.replace(".ts", ""));

  const ids = [...fileIds, ...pluginMigrations.map((m) => m.id)];

  // Ids are the primary key of the migrations table, so a collision would make
  // one migration masquerade as another already-applied one and silently never
  // run. Fail at startup instead — this is a wiring mistake, not a data error.
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length > 0) {
    throw new Error(
      `Duplicate migration id(s): ${[...new Set(duplicates)].join(", ")}. ` +
        "Plugin migration ids must not collide with each other or with a file in migrations/.",
    );
  }

  return ids;
};

/**
 * Load a migration by id from whichever source defines it
 */
const resolveMigration = async (id: string): Promise<ResolvedMigration> => {
  const plugin = pluginMigrations.find((migration) => migration.id === id);
  if (plugin) return plugin;

  const module = await import(join(MIGRATIONS_DIR, `${id}.ts`));

  return {
    id,
    name: id.replace(/^\d+_/, ""),
    up: module.up,
    down: module.down,
  };
};

/**
 * Get list of migrations that haven't been applied yet, in run order
 */
export const getPendingMigrations = async (): Promise<string[]> => {
  const appliedMigrations = await getAppliedMigrations();
  const appliedIds = new Set(appliedMigrations.map((m) => m.id));

  return getAllMigrationIds().filter((id) => !appliedIds.has(id));
};

/**
 * Run a single migration and record it as applied
 */
export const runMigration = async (id: string): Promise<void> => {
  const migration = await resolveMigration(id);

  if (typeof migration.up !== "function") {
    throw new Error(`Migration ${id} does not export an 'up' function`);
  }

  await migration.up(db);
  await recordMigration(id, migration.name);

  log.info("migrations", `Applied: ${id}`);
};

/**
 * Run all pending migrations in order
 */
export const runMigrations = async (): Promise<void> => {
  const pendingMigrations = await getPendingMigrations();

  if (pendingMigrations.length === 0) {
    log.info("migrations", "No pending migrations");
    return;
  }

  log.info(
    "migrations",
    `Running ${pendingMigrations.length} pending migrations...`,
  );

  for (const migration of pendingMigrations) {
    await runMigration(migration);
  }

  log.info("migrations", "All migrations completed");
};

/**
 * Rollback a single migration and remove it from applied migrations
 */
export const rollbackMigration = async (id: string): Promise<void> => {
  const migration = await resolveMigration(id);

  if (typeof migration.down !== "function") {
    throw new Error(`Migration ${id} does not export a 'down' function`);
  }

  await migration.down(db);
  await removeMigration(id);

  log.info("migrations", `Rolled back: ${id}`);
};

/**
 * Rollback the most recently applied migration
 */
export const rollbackLastMigration = async (): Promise<void> => {
  await ensureMigrationsTable();

  // Ordered by when it ran, not by id. Those agreed while every migration was a
  // numerically-prefixed file; a plugin id doesn't have to sort anywhere near
  // the point it was applied, and rolling back the wrong migration is not a
  // failure you notice until the schema is already wrong.
  const [lastMigration] = (await db`
    SELECT id FROM migrations ORDER BY applied_at DESC, id DESC LIMIT 1
  `) as { id: string }[];

  if (!lastMigration) {
    log.info("migrations", "No migrations to rollback");
    return;
  }

  await rollbackMigration(lastMigration.id);
};
