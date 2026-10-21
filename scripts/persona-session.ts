#!/usr/bin/env bun

/**
 * Mint a browser session for a fixture persona, and print its cookie.
 *
 *   bun run scripts/persona-session.ts priya
 *
 * Run `bun run fixtures` first. Prints `<cookie>=<session>` on stdout, like
 * `qa-session.ts`, so a browser can open as the persona without the login flow.
 * Dev and test only — see runbooks/FIXTURES.md.
 */
import { assertNotProduction } from "../src/server/fixtures/guard";

assertNotProduction(
  "persona-session",
  "it signs in as a fixed, publicly documented account.",
);

const { GUESTS, PERSONAS } = await import("../src/server/fixtures/personas");

const usage = (message: string): never => {
  console.error(
    `${message}\nUsage: persona-session <${PERSONAS.map((p) => p.key).join("|")}>`,
  );
  process.exit(1);
};

const key = process.argv[2]?.toLowerCase() ?? "";
const persona = PERSONAS.find((p) => p.key === key);
if (!persona) usage(GUESTS[key] ?? `Unknown persona: ${key || "(none)"}`);

const { db } = await import("../src/server/services/database");
const { createAuthenticatedSession, SESSION_COOKIE_NAME } = await import(
  "../src/server/services/sessions"
);

const [row] =
  await db`SELECT id FROM users WHERE email = ${persona?.email ?? ""}`;
if (!row)
  usage(
    `${persona?.email} is not in the database: run \`bun run fixtures\` first.`,
  );

const raw = await createAuthenticatedSession((row as { id: string }).id);
console.error(
  `${persona?.email} (role=${persona?.role}${persona?.orgRole ? `, org_role=${persona.orgRole}` : ""})`,
);
console.log(`${SESSION_COOKIE_NAME}=${raw}`);
process.exit(0);
