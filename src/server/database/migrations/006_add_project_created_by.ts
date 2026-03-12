import type { SQL } from "bun";

export const up = async (db: SQL): Promise<void> => {
  await db`ALTER TABLE project ADD COLUMN created_by TEXT`;
};

export const down = async (db: SQL): Promise<void> => {
  await db`ALTER TABLE project DROP COLUMN created_by`;
};
