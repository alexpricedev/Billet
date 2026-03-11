/**
 * Add guest sessions support
 * Adds session_type column and makes user_id nullable to allow guest sessions
 */
import type { SQL } from "bun";

export const up = async (db: SQL): Promise<void> => {
  await db`
    ALTER TABLE sessions
    ADD COLUMN session_type VARCHAR(20) NOT NULL DEFAULT 'authenticated'
  `;
  await db`
    ALTER TABLE sessions
    ALTER COLUMN user_id DROP NOT NULL
  `;
  await db`
    CREATE INDEX idx_sessions_session_type ON sessions(session_type)
  `;
};

export const down = async (db: SQL): Promise<void> => {
  await db`DELETE FROM sessions WHERE session_type = 'guest'`;
  await db`ALTER TABLE sessions ALTER COLUMN user_id SET NOT NULL`;
  await db`DROP INDEX IF EXISTS idx_sessions_session_type`;
  await db`ALTER TABLE sessions DROP COLUMN session_type`;
};
