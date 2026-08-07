/**
 * Add password credentials and email verification to users
 *
 * Both columns are nullable so the two auth modes coexist in one schema: a
 * magic-link user has no password_hash, a password user has one. Existing rows
 * are backfilled as verified because every user who exists at this point
 * arrived by clicking a magic link, which already proves they own the address.
 */
import type { SQL } from "bun";

export const up = async (db: SQL): Promise<void> => {
  await db`ALTER TABLE users ADD COLUMN password_hash TEXT NULL`;
  await db`ALTER TABLE users ADD COLUMN email_verified_at TIMESTAMPTZ NULL`;

  await db`UPDATE users SET email_verified_at = created_at`;
};

export const down = async (db: SQL): Promise<void> => {
  await db`ALTER TABLE users DROP COLUMN IF EXISTS email_verified_at`;
  await db`ALTER TABLE users DROP COLUMN IF EXISTS password_hash`;
};
