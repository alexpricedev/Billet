#!/usr/bin/env bun

import { SQL } from "bun";

// Note: Use --env-file=.env.test when running this script

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
async function bootstrapTestDatabase() {
  console.log("🧪 Bootstrapping test database...");

  try {
    // Drop all tables CASCADE to ensure clean state
    console.log("  Dropping existing tables...");
    await db`DROP TABLE IF EXISTS user_tokens CASCADE`;
    await db`DROP TABLE IF EXISTS sessions CASCADE`;
    await db`DROP TABLE IF EXISTS users CASCADE`;
    await db`DROP TABLE IF EXISTS example CASCADE`;
    await db`DROP TABLE IF EXISTS migrations CASCADE`;

    console.log("  Clearing migration history...");
    // Recreate migrations table fresh
    await db`
      CREATE TABLE IF NOT EXISTS migrations (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    console.log("  Running migrations...");
    // Import and run the migration system
    const { runMigrations } = await import("../database/migrate");
    await runMigrations();

    console.log("✅ Test database bootstrap complete!");
  } catch (error) {
    console.error("❌ Test database bootstrap failed:", error);
    process.exit(1);
  } finally {
    // Close database connection
    await db.end();
  }
}

// Run if called directly
if (import.meta.main) {
  await bootstrapTestDatabase();
}
