#!/usr/bin/env bun
import { db } from "../services/database";

const seed = async (): Promise<void> => {
  console.log("Seeding database...");

  // Users
  await db`
    INSERT INTO users (email, role) VALUES
      ('admin@example.com', 'admin'),
      ('alice@example.com', 'user'),
      ('bob@example.com', 'user'),
      ('carol@example.com', 'admin'),
      ('dave@example.com', 'user')
    ON CONFLICT (email) DO NOTHING
  `;

  // Examples
  await db`
    INSERT INTO example (name)
    SELECT name FROM (VALUES
      ('Hello World'),
      ('Server-Side Rendering'),
      ('Magic Link Auth')
    ) AS v(name)
    WHERE NOT EXISTS (SELECT 1 FROM example WHERE example.name = v.name)
  `;

  console.log("Seeding complete.");
};

seed()
  .catch((error) => {
    console.error("Seeding failed:", error);
    process.exit(1);
  })
  .finally(() => {
    process.exit(0);
  });
