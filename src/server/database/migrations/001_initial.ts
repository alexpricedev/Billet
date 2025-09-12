// Initial migration to document existing schema
import type { SQL } from "bun";

export const up = async (db: SQL): Promise<void> => {
  // This migration documents the existing 'example' table structure
  // The table already exists, so we just ensure it's properly structured
  await db`
    CREATE TABLE IF NOT EXISTS example (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL
    )
  `;
};

export const down = async (_db: SQL): Promise<void> => {
  // Since this documents existing schema, we don't drop it
  // In a real scenario, you might want to drop tables created in 'up'
  // await db`DROP TABLE IF EXISTS example`;
};
