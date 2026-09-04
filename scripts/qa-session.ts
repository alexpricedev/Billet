#!/usr/bin/env bun

/**
 * Mint a browser session for one of the agent's own QA accounts, and print its cookie.
 *
 * Use this — never a session belonging to `admin@example.com` or any other account a person
 * signs in with. Verifying a guarded screen means creating a session and, afterwards, deleting
 * it, and a workspace has one `DATABASE_URL`: doing that against the human's account logs them
 * out of the dev server mid-session, with nothing on screen to explain it. It happened
 * repeatedly and was reported as a database fault.
 *
 *   bun run scripts/qa-session.ts                              platform user
 *   bun run scripts/qa-session.ts --role=admin                 platform admin, for /admin
 *   bun run scripts/qa-session.ts --org-role=owner             org owner, for /team
 *   bun run scripts/qa-session.ts --role=admin --org-role=member
 *   bun run scripts/qa-session.ts --clean                      delete every QA session
 *
 * The two role flags are the two axes, and they stay separate here for the same reason they
 * are separate in the schema: "org owner who is not a platform admin" is the common case and
 * the interesting one to verify. Each combination gets its own account, named after itself, so
 * one is never mutated out from under a session another still holds. Org roles share a single
 * `QA` organisation, which is what makes a member and an owner comparable on the same page.
 *
 * Dev only, and it refuses to run otherwise: `--role=admin` creates a **platform admin** on
 * demand, at an address the operator does not control. `--clean` names the QA accounts in its
 * `WHERE`, and so must anything else you write against `sessions`.
 */
import {
  isPlatformRole,
  PLATFORM_ROLES,
  type PlatformRole,
} from "../src/server/services/auth";
import { db } from "../src/server/services/database";
import {
  isOrgRole,
  ORG_ROLES,
  type OrgRole,
} from "../src/server/services/organizations";
import {
  createAuthenticatedSession,
  SESSION_COOKIE_NAME,
} from "../src/server/services/sessions";
import { teamsEnabled } from "../src/server/services/teams-mode";

const EMAIL_PREFIX = "qa-agent";
const EMAIL_DOMAIN = "example.com";
const ORG_NAME = "QA";

if (process.env.NODE_ENV === "production") {
  console.error(
    "qa-session refuses to run with NODE_ENV=production: it would create a platform admin.",
  );
  process.exit(1);
}

const flag = (name: string): string | undefined =>
  process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1];

// A function declaration, not an arrow: TypeScript only narrows past a `never` return for one
// of those, and without the narrowing `role` below stays `string`.
function usage(message: string): never {
  console.error(
    `${message}\n` +
      `  --role=${PLATFORM_ROLES.join("|")} (default user)\n` +
      `  --org-role=${ORG_ROLES.join("|")} (default none)\n` +
      `  --clean`,
  );
  process.exit(1);
}

const rawRole = flag("role") ?? "user";
if (!isPlatformRole(rawRole)) usage(`Not a platform role: ${rawRole}`);
const role: PlatformRole = rawRole;

const rawOrgRole = flag("org-role");
if (rawOrgRole !== undefined && !isOrgRole(rawOrgRole)) {
  usage(`Not an org role: ${rawOrgRole}`);
}
const orgRole = rawOrgRole as OrgRole | undefined;

// `--clean` clears every QA account at once, whatever roles they were minted with. Scoping it
// to the one account named by the flags would leave the others signed in, which is the state
// this script exists to avoid needing to reason about.
if (process.argv.includes("--clean")) {
  const cleared = await db`
    DELETE FROM sessions
    WHERE user_id IN (
      SELECT id FROM users WHERE email LIKE ${`${EMAIL_PREFIX}-%@${EMAIL_DOMAIN}`}
    )
  `;
  console.log(`Cleared ${cleared.count} QA session(s)`);
  process.exit(0);
}

if (orgRole && !teamsEnabled()) {
  // Not fatal: the membership row is valid either way, and TEAMS_ENABLED is read per request by
  // the server process, not by this one. But /team renders a 404 without it, so say so here
  // rather than let that 404 read as a bug in the page.
  console.error(
    "Warning: TEAMS_ENABLED is not 'true' in this environment, so /team answers 404.",
  );
}

const email = orgRole
  ? `${EMAIL_PREFIX}-${role}-${orgRole}@${EMAIL_DOMAIN}`
  : `${EMAIL_PREFIX}-${role}@${EMAIL_DOMAIN}`;

const [userRow] = await db`
  INSERT INTO users (email, role) VALUES (${email}, ${role})
  ON CONFLICT (email) DO UPDATE SET role = ${role}
  RETURNING id
`;
const userId = (userRow as { id: string }).id;

if (orgRole) {
  const [orgRow] = await db`
    WITH existing AS (SELECT id FROM organizations WHERE name = ${ORG_NAME}),
    created AS (
      INSERT INTO organizations (name)
      SELECT ${ORG_NAME} WHERE NOT EXISTS (SELECT 1 FROM existing)
      RETURNING id
    )
    SELECT id FROM existing UNION ALL SELECT id FROM created
  `;
  const orgId = (orgRow as { id: string }).id;

  // user_id is UNIQUE — one org per user is structural — so a QA account that has already been
  // minted into the org is updated in place rather than joining a second one.
  await db`
    INSERT INTO organization_members (organization_id, user_id, org_role)
    VALUES (${orgId}, ${userId}, ${orgRole})
    ON CONFLICT (user_id) DO UPDATE
      SET organization_id = ${orgId}, org_role = ${orgRole}
  `;
}

const rawSessionId = await createAuthenticatedSession(userId);
console.error(`${email} (role=${role}${orgRole ? `, org_role=${orgRole}` : ""})`);
console.log(`${SESSION_COOKIE_NAME}=${rawSessionId}`);
process.exit(0);
