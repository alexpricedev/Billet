#!/usr/bin/env bun
// import { db } from "../services/database";

const seed = async (): Promise<void> => {
  console.log("Seeding database...");

  // Uncomment the db import above and add seed data here, e.g.:
  // await db`INSERT INTO users (email, role) VALUES ('admin@example.com', 'admin')`;

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
