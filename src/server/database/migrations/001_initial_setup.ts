/**
 * Initial database setup migration
 * Creates all core tables: example, users, sessions, user_tokens with indexes
 */
import type { SQL } from "bun";

export const up = async (db: SQL): Promise<void> => {
  await db`
    CREATE TABLE example (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL
    )
  `;

  await db`
    CREATE TABLE users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) NOT NULL UNIQUE,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `;

  await db`
    CREATE TABLE sessions (
      id_hash TEXT PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      last_activity_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `;

  await db`
    CREATE TABLE user_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      type VARCHAR(50) NOT NULL DEFAULT 'magic_link',
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `;

  await db`CREATE INDEX idx_sessions_user_id ON sessions(user_id)`;
  await db`CREATE INDEX idx_sessions_expires_at ON sessions(expires_at)`;
  await db`CREATE INDEX idx_sessions_last_activity ON sessions(last_activity_at)`;
  await db`CREATE INDEX idx_user_tokens_user_id ON user_tokens(user_id)`;
  await db`CREATE INDEX idx_user_tokens_type ON user_tokens(type)`;
  await db`CREATE INDEX idx_user_tokens_expires_at ON user_tokens(expires_at)`;
};

export const down = async (db: SQL): Promise<void> => {
  await db`DROP TABLE IF EXISTS user_tokens`;
  await db`DROP TABLE IF EXISTS sessions`;
  await db`DROP TABLE IF EXISTS users`;
  await db`DROP TABLE IF EXISTS example`;
};
