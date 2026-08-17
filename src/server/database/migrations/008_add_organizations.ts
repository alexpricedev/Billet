/**
 * Organisations, membership, and invites.
 *
 * Runs in every fork regardless of TEAMS_ENABLED — migrations are not
 * conditional and must not be. Nothing is backfilled: an org is created only
 * when a signed-in user deliberately submits POST /team, so with the flag off
 * these tables stay empty and the three user columns stay NULL, exactly as
 * migration 007 left password_hash NULL for magic-link forks.
 *
 * Membership is columns on `users` rather than a join table because a user
 * belongs to exactly one org. A join table permits two rows, so every read
 * would have to defend against a state that must never exist; the columns make
 * the rule structural.
 *
 * The CHECK constraints are named, unlike migration 004's inline anonymous one.
 * That is what makes adding a fourth org role possible later: a new migration
 * drops `users_org_role_check` and `organization_invites_role_check` and
 * re-adds them. The roles are not free-form.
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

  // ON DELETE SET NULL, never CASCADE: deleting an org must not delete the
  // accounts of everyone in it. The all-or-nothing CHECK below means the role
  // has to be nulled in the same statement, so org deletion goes through the
  // service rather than a bare DELETE.
  await db`
    ALTER TABLE users
      ADD COLUMN org_id UUID NULL REFERENCES organizations(id) ON DELETE SET NULL,
      ADD COLUMN org_role VARCHAR(20) NULL
        CONSTRAINT users_org_role_check
        CHECK (org_role IN ('owner', 'admin', 'member')),
      ADD COLUMN org_joined_at TIMESTAMPTZ NULL,
      ADD CONSTRAINT users_org_all_or_nothing
        CHECK (num_nonnulls(org_id, org_role, org_joined_at) IN (0, 3))
  `;

  await db`CREATE INDEX idx_users_org_id ON users(org_id)`;

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

export const down = async (db: SQL): Promise<void> => {
  await db`DROP TABLE IF EXISTS organization_invites`;

  await db`
    ALTER TABLE users
      DROP CONSTRAINT IF EXISTS users_org_all_or_nothing,
      DROP COLUMN IF EXISTS org_joined_at,
      DROP COLUMN IF EXISTS org_role,
      DROP COLUMN IF EXISTS org_id
  `;

  await db`DROP TABLE IF EXISTS organizations`;
};
