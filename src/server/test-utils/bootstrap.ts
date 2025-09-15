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
    await db`DROP TABLE IF EXISTS user_tokens CASCADE`;
    await db`DROP TABLE IF EXISTS sessions CASCADE`;
    await db`DROP TABLE IF EXISTS users CASCADE`;
    await db`DROP TABLE IF EXISTS example CASCADE`;
    await db`DROP TABLE IF EXISTS migrations CASCADE`;

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
