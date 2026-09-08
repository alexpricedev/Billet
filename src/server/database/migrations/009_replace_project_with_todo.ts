import type { SQL } from "bun";

// The demo resource becomes a todo list. `project` is starter content, not
// data anyone migrates, so this drops it rather than renaming and altering:
// a fork that kept the table gets a clean `todo` and loses nothing it wrote
// on purpose. `down` restores the old shape, empty.
export const up = async (db: SQL): Promise<void> => {
  await db`DROP TABLE IF EXISTS project`;
  await db`
    CREATE TABLE todo (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      completed_at TIMESTAMPTZ,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
};

export const down = async (db: SQL): Promise<void> => {
  await db`DROP TABLE IF EXISTS todo`;
  await db`
    CREATE TABLE project (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      created_by TEXT
    )
  `;
};
