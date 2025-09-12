#!/usr/bin/env bun

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  getPendingMigrations,
  rollbackLastMigration,
  runMigrations,
} from "./migrate";

const command = process.argv[2];

switch (command) {
  case "up":
    await runMigrations();
    break;

  case "create": {
    const migrationName = process.argv[3];
    if (!migrationName) {
      console.error("Usage: bun run migrate:create <migration_name>");
      process.exit(1);
    }

    // Generate migration ID with timestamp
    const timestamp = new Date()
      .toISOString()
      .replace(/[-T:.Z]/g, "")
      .slice(0, 14);
    const migrationId = `${timestamp}_${migrationName}`;
    const filename = `${migrationId}.ts`;

    const template = `// Migration: ${migrationName}
import type { SQL } from "bun";

export const up = async (db: SQL): Promise<void> => {
  // Add your migration code here
};

export const down = async (db: SQL): Promise<void> => {
  // Add rollback code here
};
`;

    const migrationPath = join(
      process.cwd(),
      "src/server/database/migrations",
      filename,
    );
    writeFileSync(migrationPath, template);
    console.log(`Created migration: ${filename}`);
    break;
  }

  case "status": {
    const pending = await getPendingMigrations();
    if (pending.length === 0) {
      console.log("All migrations are up to date");
    } else {
      console.log(`Pending migrations: ${pending.length}`);
      for (const migration of pending) {
        console.log(`  - ${migration}`);
      }
    }
    break;
  }

  case "down":
    await rollbackLastMigration();
    break;

  default:
    console.log("Available commands:");
    console.log("  up     - Run pending migrations");
    console.log("  create - Create a new migration");
    console.log("  status - Show migration status");
    console.log("  down   - Rollback the last migration");
    break;
}
