import type { SQL } from "bun";

export const up = async (db: SQL): Promise<void> => {
  await db`ALTER TABLE example RENAME TO project`;
  await db`ALTER TABLE project RENAME COLUMN name TO title`;
  await db`ALTER SEQUENCE example_id_seq RENAME TO project_id_seq`;
};

export const down = async (db: SQL): Promise<void> => {
  await db`ALTER SEQUENCE project_id_seq RENAME TO example_id_seq`;
  await db`ALTER TABLE project RENAME COLUMN title TO name`;
  await db`ALTER TABLE project RENAME TO example`;
};
