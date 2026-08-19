import { randomUUID } from "node:crypto";
import { computeHMAC, generateSecureToken } from "../utils/crypto";
import { findOrCreateUser, type User } from "./auth";
import { db } from "./database";
import {
  joinOrganization,
  type Organization,
  type OrgRole,
} from "./organizations";

const DAY_MS = 24 * 60 * 60 * 1000;

// Longer than every auth token, deliberately. An invite grants org membership,
// not a session or account takeover; it goes to a colleague who may not be at a
// keyboard; and unlike the auth tokens it can be revoked, so a long life is not
// an uncancellable one.
const INVITE_TTL_MS = 7 * DAY_MS;

// Derived rather than restated, like MAGIC_LINK_EXPIRY_MINUTES in auth.ts, so
// the email copy can't promise an expiry the token doesn't have.
export const ORG_INVITE_EXPIRY_DAYS = INVITE_TTL_MS / DAY_MS;

// Inviting sends mail to an arbitrary address on the org's behalf. A cap means
// a compromised owner account can't become a spam relay from the fork's
// verified sending domain — which would cost it the deliverability reputation
// runbooks/EMAIL.md exists to protect.
export const MAX_LIVE_INVITES_PER_ORG = 50;

export interface Invite {
  id: string;
  organization_id: string;
  email: string;
  org_role: OrgRole;
  invited_by: string | null;
  expires_at: Date;
  created_at: Date;
}

/** What the accept page needs to render without consuming anything. */
export interface InvitePreview {
  organizationName: string;
  email: string;
  org_role: OrgRole;
}

const toInvite = (row: {
  id: string;
  organization_id: string;
  email: string;
  org_role: OrgRole;
  invited_by: string | null;
  expires_at: string | Date;
  created_at: string | Date;
}): Invite => ({
  id: row.id,
  organization_id: row.organization_id,
  email: row.email,
  org_role: row.org_role,
  invited_by: row.invited_by,
  expires_at: new Date(row.expires_at),
  created_at: new Date(row.created_at),
});

export type CreateInviteResult =
  | { success: true; invite: Invite; rawToken: string }
  | {
      success: false;
      error: "already-member" | "invalid-email" | "too-many-invites";
    };

/**
 * Invite an address to an org, returning the raw token exactly once.
 *
 * Only the HMAC is stored, matching createUserToken in auth.ts — a database
 * dump can't be replayed as an invite, because the raw value exists only in the
 * email that carries it.
 *
 * Re-inviting is idempotent by design: any live invite for the address is
 * revoked and a fresh one issued in the same call, so a double-click produces a
 * new working link rather than an error. The partial unique index is the
 * backstop for a race, not the mechanism.
 */
export const createInvite = async (
  orgId: string,
  email: string,
  role: OrgRole,
  invitedByUserId: string,
): Promise<CreateInviteResult> => {
  const normalizedEmail = email.toLowerCase().trim();

  if (!normalizedEmail.includes("@") || normalizedEmail.length > 255) {
    return { success: false, error: "invalid-email" };
  }

  const alreadyMember = await db`
    SELECT m.id
    FROM organization_members m
    JOIN users u ON u.id = m.user_id
    WHERE u.email = ${normalizedEmail} AND m.organization_id = ${orgId}
  `;

  if (alreadyMember.length > 0) {
    return { success: false, error: "already-member" };
  }

  const [{ count: liveCount }] = await db`
    SELECT count(*)::int AS count
    FROM organization_invites
    WHERE organization_id = ${orgId}
      AND accepted_at IS NULL
      AND revoked_at IS NULL
      AND expires_at > CURRENT_TIMESTAMP
  `;

  if ((liveCount as number) >= MAX_LIVE_INVITES_PER_ORG) {
    return { success: false, error: "too-many-invites" };
  }

  await db`
    UPDATE organization_invites
    SET revoked_at = CURRENT_TIMESTAMP
    WHERE organization_id = ${orgId}
      AND email = ${normalizedEmail}
      AND accepted_at IS NULL
      AND revoked_at IS NULL
  `;

  const rawToken = generateSecureToken(32);
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

  const inserted = await db`
    INSERT INTO organization_invites
      (id, organization_id, email, org_role, token_hash, invited_by, expires_at)
    VALUES (
      ${randomUUID()},
      ${orgId},
      ${normalizedEmail},
      ${role},
      ${computeHMAC(rawToken)},
      ${invitedByUserId},
      ${expiresAt.toISOString()}
    )
    RETURNING id, organization_id, email, org_role, invited_by, expires_at, created_at
  `;

  return { success: true, invite: toInvite(inserted[0]), rawToken };
};

/**
 * Live, unexpired invites for an org.
 *
 * Expiry is filtered at read time rather than relying on a sweep — cleanupExpired
 * in auth.ts has no caller, and an invite list that showed dead invites as
 * pending would be actively misleading.
 */
export const listInvites = async (orgId: string): Promise<Invite[]> => {
  const results = await db`
    SELECT id, organization_id, email, org_role, invited_by, expires_at, created_at
    FROM organization_invites
    WHERE organization_id = ${orgId}
      AND accepted_at IS NULL
      AND revoked_at IS NULL
      AND expires_at > CURRENT_TIMESTAMP
    ORDER BY created_at DESC
  `;

  return results.map(toInvite);
};

/** Scoped by org_id: revoking another org's invite must be inert, not an error. */
export const revokeInvite = async (
  orgId: string,
  inviteId: string,
): Promise<boolean> => {
  const revoked = await db`
    UPDATE organization_invites
    SET revoked_at = CURRENT_TIMESTAMP
    WHERE id = ${inviteId}
      AND organization_id = ${orgId}
      AND accepted_at IS NULL
      AND revoked_at IS NULL
    RETURNING id
  `;

  return revoked.length > 0;
};

/**
 * Look at an invite without spending it, for rendering the accept page.
 *
 * /reset-password deliberately does not do this (see the comment there): its
 * page is byte-identical either way, so a peek would only sort real tokens from
 * guesses. Here the page genuinely differs — it names the org, and in password
 * mode it decides whether to show a password field — so a page that works is
 * worth the narrow oracle, against a 256-bit token on a rate-limited route.
 */
export const peekInvite = async (
  rawToken: string,
): Promise<InvitePreview | null> => {
  const results = await db`
    SELECT i.email, i.org_role, o.name
    FROM organization_invites i
    JOIN organizations o ON o.id = i.organization_id
    WHERE i.token_hash = ${computeHMAC(rawToken)}
      AND i.accepted_at IS NULL
      AND i.revoked_at IS NULL
      AND i.expires_at > CURRENT_TIMESTAMP
  `;

  if (results.length === 0) return null;

  return {
    organizationName: results[0].name as string,
    email: results[0].email as string,
    org_role: results[0].org_role as OrgRole,
  };
};

/**
 * Claim an invite, returning it exactly once.
 *
 * The single UPDATE ... RETURNING is what makes this race-safe, copied from
 * consumeUserToken: two concurrent clicks on the same link both try to flip
 * accepted_at, and only the one that moves it from NULL gets a row back.
 */
export const consumeInvite = async (
  rawToken: string,
): Promise<Invite | null> => {
  const results = await db`
    UPDATE organization_invites
    SET accepted_at = CURRENT_TIMESTAMP
    WHERE token_hash = ${computeHMAC(rawToken)}
      AND accepted_at IS NULL
      AND revoked_at IS NULL
      AND expires_at > CURRENT_TIMESTAMP
    RETURNING id, organization_id, email, org_role, invited_by, expires_at, created_at
  `;

  return results.length > 0 ? toInvite(results[0]) : null;
};

export type AcceptInviteResult =
  | { success: true; user: User; organization: Organization }
  | {
      success: false;
      error: "invalid-token" | "email-mismatch" | "already-in-org";
    };

/**
 * Accept an invite: claim it, resolve the account, and join the org.
 *
 * `signedInUserId` is the visitor's current session, if any. An invite is bound
 * to the address it was sent to, so accepting while signed in as somebody else
 * must fail — otherwise forwarding the link turns it into a join-anyone link.
 * That check happens before the token is spent.
 *
 * Deliberately touches neither passwords nor sessions: the controller owns
 * those, which keeps this testable without a request.
 */
export const acceptInvite = async (
  rawToken: string,
  signedInUserId: string | null,
): Promise<AcceptInviteResult> => {
  const preview = await peekInvite(rawToken);
  if (!preview) return { success: false, error: "invalid-token" };

  if (signedInUserId) {
    const signedIn = await db`
      SELECT u.email, m.organization_id
      FROM users u
      LEFT JOIN organization_members m ON m.user_id = u.id
      WHERE u.id = ${signedInUserId}
    `;

    if (signedIn.length === 0) {
      return { success: false, error: "invalid-token" };
    }

    if ((signedIn[0].email as string) !== preview.email) {
      return { success: false, error: "email-mismatch" };
    }

    if (signedIn[0].organization_id) {
      return { success: false, error: "already-in-org" };
    }
  }

  const invite = await consumeInvite(rawToken);
  if (!invite) return { success: false, error: "invalid-token" };

  const user = await findOrCreateUser(invite.email);

  const joined = await joinOrganization(
    user.id,
    invite.organization_id,
    invite.org_role,
  );

  if (!joined) {
    return { success: false, error: "already-in-org" };
  }

  // The token only ever reached a mailbox the recipient could open, so this
  // proves the address exactly as clicking a magic link does. COALESCE keeps
  // the original timestamp for an account that was already verified.
  const verified = await db`
    UPDATE users
    SET email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP)
    WHERE id = ${user.id}
    RETURNING id, email, role, created_at, email_verified_at
  `;

  const organization = await db`
    SELECT id, name, created_at FROM organizations
    WHERE id = ${invite.organization_id}
  `;

  return {
    success: true,
    user: {
      ...user,
      email_verified_at: verified[0].email_verified_at
        ? new Date(verified[0].email_verified_at)
        : null,
    },
    organization: {
      id: organization[0].id as string,
      name: organization[0].name as string,
      created_at: new Date(organization[0].created_at),
    },
  };
};
