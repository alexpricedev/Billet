#!/usr/bin/env bun

/**
 * Replace this workspace's data with the fixture set from `src/server/fixtures/`.
 *
 *   bun run fixtures
 *
 * Truncates every app table, so anyone signed in against this DATABASE_URL is signed
 * out and loses their rows. Dev and test only — see runbooks/FIXTURES.md.
 */
import {
  assertLocalDatabase,
  assertNotProduction,
} from "../src/server/fixtures/guard";

assertNotProduction(
  "fixtures",
  "it truncates every table and creates accounts with a published password.",
);
assertLocalDatabase("fixtures");

// Imported after the guard: the database module throws at import without DATABASE_URL.
const { db } = await import("../src/server/services/database");
const { loadFixtures } = await import("../src/server/fixtures/load");
const { PERSONAS, ZOFIA, FIXTURE_PASSWORD } = await import(
  "../src/server/fixtures/personas"
);
const { appUrl } = await import("../src/server/utils/app-url");
const { teamsEnabled } = await import("../src/server/services/teams-mode");

const target = new URL(process.env.DATABASE_URL ?? "").pathname.slice(1);
console.error(
  `Loading fixtures into database "${target}" (every table is cleared)`,
);

await loadFixtures(db);

if (!teamsEnabled()) {
  console.error(
    "Warning: TEAMS_ENABLED is not 'true' in this environment, so /team answers 404.",
  );
}
console.log(
  `Loaded ${PERSONAS.length} accounts, Northwind, 1 pending invite, 4 todos.`,
);
console.log(`Password mode sign-in, any account: ${FIXTURE_PASSWORD}`);
console.log(
  `Zofia's invite: ${appUrl(`/invites/accept?token=${encodeURIComponent(ZOFIA.inviteToken)}`)}`,
);
process.exit(0);
