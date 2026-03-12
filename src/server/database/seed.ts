#!/usr/bin/env bun
import { db } from "../services/database";
import { log } from "../services/logger";

export const seedIfEmpty = async (): Promise<void> => {
  const [{ count: userCount }] =
    await db`SELECT count(*)::int AS count FROM users`;
  const [{ count: exampleCount }] =
    await db`SELECT count(*)::int AS count FROM example`;

  if (userCount > 0 || exampleCount > 0) return;

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
    INSERT INTO example (name)
    SELECT name FROM (VALUES
      ('Hello World'),
      ('Server-Side Rendering'),
      ('Magic Link Auth')
    ) AS v(name)
    WHERE NOT EXISTS (SELECT 1 FROM example WHERE example.name = v.name)
  `;

  log.info("seed", "Seeded 5 users and 3 examples");
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
