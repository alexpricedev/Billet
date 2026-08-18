#!/usr/bin/env bun
import { db } from "../services/database";
import { log } from "../services/logger";
import { organisationsEnabled } from "../services/organisations-mode";

export const seedIfEmpty = async (): Promise<void> => {
  const [{ count: userCount }] =
    await db`SELECT count(*)::int AS count FROM users`;
  const [{ count: projectCount }] =
    await db`SELECT count(*)::int AS count FROM project`;

  if (userCount > 0 || projectCount > 0) return;

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

  // Starter users have no organisation, which assertOrganisationsReady refuses
  // to boot on. Put them all in one so a fresh database with the flag on starts,
  // and so /organisation has a members list worth looking at.
  if (organisationsEnabled()) {
    const [organisation] = await db`
      INSERT INTO organisations (name) VALUES ('Example Organisation')
      RETURNING id
    `;

    await db`
      INSERT INTO organisation_members (organisation_id, user_id, role)
      SELECT
        ${organisation.id},
        id,
        CASE WHEN email = 'admin@example.com' THEN 'owner' ELSE 'member' END
      FROM users
    `;

    log.info("seed", "Seeded 1 organisation with 5 members");
  }

  await db`
    INSERT INTO project (title, created_by)
    SELECT title, created_by FROM (VALUES
      ('Hello World', 'alice@example.com'),
      ('Server-Side Rendering', NULL),
      ('Magic Link Auth', 'admin@example.com')
    ) AS v(title, created_by)
    WHERE NOT EXISTS (SELECT 1 FROM project WHERE project.title = v.title)
  `;

  log.info("seed", "Seeded 5 users and 3 projects");
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
