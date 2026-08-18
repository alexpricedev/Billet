/**
 * Add organisations, memberships and invites
 *
 * Membership is a join table rather than a column on users so the "one
 * organisation per user" rule is a UNIQUE constraint that can be dropped later
 * without a schema rewrite, and so a membership can carry a role.
 *
 * Invites get their own table rather than reusing user_tokens: that table's
 * user_id is NOT NULL REFERENCES users(id), and an invite is addressed to an
 * email that has no user row yet. The mechanism is otherwise identical — store
 * only the HMAC of the token, claim it with a single race-safe UPDATE.
 *
 * Nothing is backfilled. Existing users are left without a membership, and
 * assertOrganisationsReady refuses to boot with the flag on until whoever owns
 * the app decides what those users should belong to.
 */
import type { SQL } from "bun";

export const up = async (db: SQL): Promise<void> => {
  await db`
    CREATE TABLE organisations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `;

  await db`
    CREATE TABLE organisation_members (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role VARCHAR(50) NOT NULL DEFAULT 'member',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      -- One organisation per user. Drop this to allow many.
      UNIQUE (user_id)
    )
  `;

  await db`
    CREATE INDEX idx_organisation_members_org ON organisation_members(organisation_id)
  `;

  await db`
    CREATE TABLE organisation_invites (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      invited_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      accepted_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `;

  await db`
    CREATE INDEX idx_organisation_invites_org ON organisation_invites(organisation_id)
  `;

  // One live invite per address per organisation. Partial so a revoked or
  // accepted invite doesn't block re-inviting someone who left.
  await db`
    CREATE UNIQUE INDEX idx_organisation_invites_pending
      ON organisation_invites(organisation_id, email)
      WHERE accepted_at IS NULL
  `;
};

export const down = async (db: SQL): Promise<void> => {
  await db`DROP TABLE IF EXISTS organisation_invites`;
  await db`DROP TABLE IF EXISTS organisation_members`;
  await db`DROP TABLE IF EXISTS organisations`;
};
