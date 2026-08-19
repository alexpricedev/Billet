/**
 * Organisations, membership, and invites.
 *
 * Runs in every fork regardless of TEAMS_ENABLED — migrations are not
 * conditional and must not be. Nothing is backfilled: an org is created only
 * when a signed-in user deliberately submits POST /team, so with the flag off
 * these tables stay empty.
 *
 * Every table this adds is its own; nothing here alters `users`. That is the
 * point. A fork with no intention of using teams deletes this file along with
 * the team code and has an untouched schema, and a fork that already ran it
 * runs the `down` below — three DROP TABLEs that cannot reach an account row.
 * An ALTER TABLE users would have made removal a migration someone has to write
 * and get right against live account data.
 *
 * A user belongs to exactly one org, and `organization_members.user_id` is
 * UNIQUE, so that is structural rather than defended for on every read. It also
 * makes "half a membership" unrepresentable — the org, the role and the join
 * date are one row, so it exists or it doesn't.
 *
 * The CHECK constraints are named, unlike migration 004's inline anonymous one.
 * That is what makes adding a fourth org role possible later: a new migration
 * drops `organization_members_role_check` and `organization_invites_role_check`
 * and re-adds them. The roles are not free-form.
 */
import type { SQL } from "bun";

export const up = async (db: SQL): Promise<void> => {
  await db`
    CREATE TABLE organizations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(100) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `;

  // Both foreign keys CASCADE, and both delete only the membership. Deleting an
  // org removes everyone's standing in it and no accounts; deleting an account
  // removes its membership and no org. Neither direction can take the other's
  // rows with it, which is what ON DELETE SET NULL on a users column was
  // contorting to achieve.
  await db`
    CREATE TABLE organization_members (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      org_role VARCHAR(20) NOT NULL
        CONSTRAINT organization_members_role_check
        CHECK (org_role IN ('owner', 'admin', 'member')),
      joined_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `;

  await db`
    CREATE INDEX idx_organization_members_org
      ON organization_members(organization_id)
  `;

  // Invites get their own table rather than a user_tokens type. user_tokens
  // requires a NOT NULL user_id, which would mean creating a shell users row
  // for every address typed into the invite box — and in password mode
  // signInWithPassword reports "no-password" distinguishably from
  // "invalid-credentials", so those rows would turn /login into an oracle for
  // "this address was invited to something once". The table also gives the
  // invite somewhere to carry its org and role, which consumeUserToken has no
  // room for, and makes revocation expressible.
  await db`
    CREATE TABLE organization_invites (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      email VARCHAR(255) NOT NULL,
      org_role VARCHAR(20) NOT NULL DEFAULT 'member'
        CONSTRAINT organization_invites_role_check
        CHECK (org_role IN ('owner', 'admin', 'member')),
      token_hash TEXT NOT NULL UNIQUE,
      invited_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      accepted_at TIMESTAMPTZ NULL,
      revoked_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `;

  // At most one *live* invite per address per org. accepted_at and revoked_at
  // are separate nullable timestamps rather than a status enum precisely so
  // this can be expressed declaratively — and so accepted invites survive as an
  // audit trail instead of being deleted.
  await db`
    CREATE UNIQUE INDEX idx_organization_invites_live
      ON organization_invites(organization_id, email)
      WHERE accepted_at IS NULL AND revoked_at IS NULL
  `;

  await db`
    CREATE INDEX idx_organization_invites_org
      ON organization_invites(organization_id)
  `;
  await db`
    CREATE INDEX idx_organization_invites_expires_at
      ON organization_invites(expires_at)
  `;
};

// Reversible without touching `users`, which is the whole reason membership is a
// table. A fork dropping the feature runs this and is back to a stock schema.
export const down = async (db: SQL): Promise<void> => {
  await db`DROP TABLE IF EXISTS organization_invites`;
  await db`DROP TABLE IF EXISTS organization_members`;
  await db`DROP TABLE IF EXISTS organizations`;
};
