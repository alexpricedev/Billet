/**
 * The fixture set: the people and data of `ux/personas.md`, as code.
 *
 * `ux/personas.md` is the source of truth and `personas.test.ts` parses it, so
 * editing one without the other fails the suite. Ids and timestamps are fixed so
 * two loads produce the same rows. A fork replaces this file with its own cast —
 * see `runbooks/FIXTURES.md`.
 */
import type { PlatformRole } from "../services/auth";
import type { OrgRole } from "../services/organizations";

/**
 * Every fixture account's password, for password mode. Dev and test only: it is
 * public, and `scripts/fixtures.ts` refuses to run in production.
 */
export const FIXTURE_PASSWORD = "fixture-password-1234";

// An argon2id hash of FIXTURE_PASSWORD, computed once. Hashing at load time would
// draw a fresh salt, and two loads would differ in `password_hash`.
// `personas.test.ts` checks that it still verifies.
export const FIXTURE_PASSWORD_HASH =
  "$argon2id$v=19$m=65536,t=2,p=1$hrx6BDIbY2SKa/3THe5xq7LWgv9IMTs+wyqxtV9LhZ4$mIY8oKiZxuSctRGrgR/O2tV9Cn6uHAjtTeaunZXKGXA";

export const FIXTURE_CREATED_AT = "2026-01-05T09:00:00.000Z";

export interface Persona {
  key: string;
  id: string;
  email: string;
  name: string;
  role: PlatformRole;
  orgRole: OrgRole | null;
  // Jo is the user with no optional fields: no password, not verified, no team.
  optionalFields: boolean;
}

export const ORGANIZATION = {
  id: "00000000-0000-4000-8000-0000000000a1",
  name: "Northwind",
  createdAt: "2026-01-05T09:05:00.000Z",
};

export const PERSONAS: readonly Persona[] = [
  {
    key: "priya",
    id: "00000000-0000-4000-8000-000000000001",
    email: "priya@example.com",
    name: "Priya Shah",
    role: "user",
    orgRole: "owner",
    optionalFields: true,
  },
  {
    key: "ade",
    id: "00000000-0000-4000-8000-000000000002",
    email: "ade@example.com",
    name: "Ade Mensah",
    role: "user",
    orgRole: "admin",
    optionalFields: true,
  },
  {
    key: "tom",
    id: "00000000-0000-4000-8000-000000000003",
    email: "tom@example.com",
    name: "Tom Okafor",
    role: "user",
    orgRole: "member",
    optionalFields: true,
  },
  {
    key: "jo",
    id: "00000000-0000-4000-8000-000000000004",
    email: "jo@example.com",
    name: "Jo Bell",
    role: "user",
    orgRole: null,
    optionalFields: false,
  },
  {
    key: "morgan",
    id: "00000000-0000-4000-8000-000000000005",
    email: "morgan@example.com",
    name: "Morgan Lee",
    role: "admin",
    orgRole: null,
    optionalFields: true,
  },
];

/**
 * Zofia has no account: she holds a pending invite to Northwind and creates the
 * account by accepting it (story 06). Sam, the guest, has neither.
 */
export const ZOFIA = {
  key: "zofia",
  email: "zofia.wisniewska-kowalczyk.design-studio@example.com",
  inviteId: "00000000-0000-4000-8000-0000000000b1",
  // Fixed so the accept link is the same after every load.
  inviteToken: "fixture-invite-zofia-0000000000000000",
  orgRole: "member" as OrgRole,
  createdAt: "2026-01-06T09:00:00.000Z",
  // Far future on purpose: "fixed" and "always valid" can only both hold if the
  // invite outlives the fixture.
  expiresAt: "2099-01-01T00:00:00.000Z",
};

export const GUESTS: Readonly<Record<string, string>> = {
  sam: "Sam is a guest: no account, no session.",
  zofia:
    "Zofia has no account, only a pending invite — she starts signed out (story 06).",
};

export interface FixtureTodo {
  id: number;
  title: string;
  completedAt: string | null;
  createdBy: string | null;
  createdAt: string;
}

export const TODOS: readonly FixtureTodo[] = [
  {
    id: 1,
    title: "Book the team offsite",
    completedAt: "2026-01-08T10:00:00.000Z",
    createdBy: "priya@example.com",
    createdAt: "2026-01-07T09:00:00.000Z",
  },
  {
    id: 2,
    title:
      `Write the quarterly plan: ${"a long, rambling title ".repeat(9)}`.slice(
        0,
        200,
      ),
    completedAt: null,
    createdBy: "priya@example.com",
    createdAt: "2026-01-07T09:30:00.000Z",
  },
  {
    id: 3,
    title: "Ship the release 🚀 and celebrate 🎉 with café ☕",
    completedAt: null,
    createdBy: "tom@example.com",
    createdAt: "2026-01-07T10:00:00.000Z",
  },
  {
    id: 4,
    title: "Anonymous todo with no owner",
    completedAt: null,
    createdBy: null,
    createdAt: "2026-01-07T10:30:00.000Z",
  },
];
