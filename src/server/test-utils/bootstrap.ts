#!/usr/bin/env bun

import { SQL } from "bun";

/**
 * Test database bootstrap script
 * Use: bun --env-file=.env.test run src/server/test-utils/bootstrap.ts
 */

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set in .env.test");
}

const db = new SQL(process.env.DATABASE_URL);

/**
 * Bootstrap test database
 * - Drop all tables CASCADE (clean slate)
 * - Clear migration history
 * - Run migrations fresh
 */
export async function bootstrap() {
  console.log("🧪 Bootstrapping test database...");

  try {
    console.log("  Dropping existing tables...");
    // Discovered, not listed. A hardcoded list goes stale the moment a
    // migration adds or renames a table (it still named `example` two
    // migrations after that became `project`), and it can never know about a
    // table a plugin migration created — which would then survive the "clean
    // slate" and leak into the next run.
    const tables = (await db`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    `) as { tablename: string }[];

    for (const { tablename } of tables) {
      // Identifiers can't be parameterised. These names come from the
      // database's own catalog rather than any user input, and the pattern
      // guard keeps that true even if a table is created with an exotic name.
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tablename)) {
        throw new Error(
          `Refusing to drop table with unexpected name: ${tablename}`,
        );
      }
      await db.unsafe(`DROP TABLE IF EXISTS "${tablename}" CASCADE`);
    }

    console.log("  Clearing migration history...");
    await db`
      CREATE TABLE IF NOT EXISTS migrations (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    console.log("  Running migrations...");
    const { runMigrations } = await import("../database/migrate");
    await runMigrations();

    console.log("✅ Test database bootstrap complete!");
  } catch (error) {
    console.error("❌ Test database bootstrap failed:", error);
    process.exit(1);
  } finally {
    await db.end();
  }
}

if (import.meta.main) {
  await bootstrap();
}
