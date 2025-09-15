/**
 * Add CSRF secret column to sessions table
 * Stores per-session secrets for CSRF token generation
 */
import type { SQL } from "bun";

export const up = async (db: SQL): Promise<void> => {
  await db`
    ALTER TABLE sessions 
    ADD COLUMN csrf_secret TEXT NULL
  `;

  await db`CREATE INDEX idx_sessions_csrf_secret ON sessions(csrf_secret) WHERE csrf_secret IS NOT NULL`;
};

export const down = async (db: SQL): Promise<void> => {
  await db`DROP INDEX IF EXISTS idx_sessions_csrf_secret`;
  await db`ALTER TABLE sessions DROP COLUMN IF EXISTS csrf_secret`;
};
