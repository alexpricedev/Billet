import type { SQL } from "bun";
import { computeHMAC } from "../utils/crypto";
import {
  FIXTURE_CREATED_AT,
  FIXTURE_PASSWORD_HASH,
  ORGANIZATION,
  PERSONAS,
  TODOS,
  ZOFIA,
} from "./personas";

/**
 * Replace the app's tables with the fixture set, in one transaction.
 *
 * Sessions are not created here — `scripts/persona-session.ts` mints them — but
 * the truncate does end every existing one.
 */
export const loadFixtures = async (db: SQL): Promise<void> => {
  await db.begin(async (tx) => {
    await tx`
      TRUNCATE TABLE
        organization_invites, organization_members, organizations,
        user_tokens, sessions, users,
        todo
      RESTART IDENTITY CASCADE
    `;

    for (const p of PERSONAS) {
      await tx`
        INSERT INTO users
          (id, email, role, password_hash, email_verified_at, created_at)
        VALUES (
          ${p.id}, ${p.email}, ${p.role},
          ${p.optionalFields ? FIXTURE_PASSWORD_HASH : null},
          ${p.optionalFields ? FIXTURE_CREATED_AT : null},
          ${FIXTURE_CREATED_AT}
        )
      `;
    }

    await tx`
      INSERT INTO organizations (id, name, created_at)
      VALUES (${ORGANIZATION.id}, ${ORGANIZATION.name}, ${ORGANIZATION.createdAt})
    `;

    for (const p of PERSONAS) {
      if (!p.orgRole) continue;
      await tx`
        INSERT INTO organization_members
          (id, organization_id, user_id, org_role, joined_at)
        VALUES (
          ${memberId(p.id)}, ${ORGANIZATION.id}, ${p.id}, ${p.orgRole},
          ${ORGANIZATION.createdAt}
        )
      `;
    }

    const owner = PERSONAS.find((p) => p.orgRole === "owner");
    await tx`
      INSERT INTO organization_invites
        (id, organization_id, email, org_role, token_hash, invited_by,
         expires_at, created_at)
      VALUES (
        ${ZOFIA.inviteId}, ${ORGANIZATION.id}, ${ZOFIA.email}, ${ZOFIA.orgRole},
        ${computeHMAC(ZOFIA.inviteToken)}, ${owner?.id ?? null},
        ${ZOFIA.expiresAt}, ${ZOFIA.createdAt}
      )
    `;

    for (const t of TODOS) {
      await tx`
        INSERT INTO todo (id, title, completed_at, created_by, created_at)
        VALUES (${t.id}, ${t.title}, ${t.completedAt}, ${t.createdBy}, ${t.createdAt})
      `;
    }
    // Explicit ids leave the SERIAL behind them; the next todo created in the
    // app would collide with fixture id 1.
    await tx`SELECT setval('todo_id_seq', ${Math.max(...TODOS.map((t) => t.id))})`;
  });
};

// Memberships get ids derived from the user's, so they are fixed too.
const memberId = (userId: string): string =>
  userId.replace("-4000-8000-", "-4000-9000-");
