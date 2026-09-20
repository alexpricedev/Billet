#!/usr/bin/env bun
import { db } from "../services/database";
import { log } from "../services/logger";

export const seedIfEmpty = async (): Promise<void> => {
  const [{ count: userCount }] =
    await db`SELECT count(*)::int AS count FROM users`;
  const [{ count: todoCount }] =
    await db`SELECT count(*)::int AS count FROM todo`;

  if (userCount > 0 || todoCount > 0) return;

  log.info("seed", "Empty database detected — seeding starter data");

  await db`
    INSERT INTO users (email, role) VALUES
      ('admin@example.com', 'admin'),
      ('alice@example.com', 'user'),
      ('bob@example.com', 'user'),
      ('carol@example.com', 'admin'),
      ('dave@example.com', 'user')
    ON CONFLICT (email) DO NOTHING
  `;

  await db`
    INSERT INTO todo (title, completed_at, created_by)
    SELECT title, completed_at, created_by FROM (VALUES
      ('Read the README', now(), 'alice@example.com'),
      ('Add a todo without a page reload', NULL, NULL),
      ('Ship it', NULL, 'admin@example.com')
    ) AS v(title, completed_at, created_by)
    WHERE NOT EXISTS (SELECT 1 FROM todo WHERE todo.title = v.title)
  `;

  log.info("seed", "Seeded 5 users and 3 todos");
};

// Allow running directly via `bun run seed`
if (import.meta.main) {
  seedIfEmpty()
    .catch((error) => {
      console.error("Seeding failed:", error);
      process.exit(1);
    })
    .finally(() => {
      process.exit(0);
    });
}
