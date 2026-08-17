# Teams

Org-level user management: one organisation per user, invitations by email, and three org
roles. Off by default behind `TEAMS_ENABLED`.

---

## 1. What Billet ships

| Route | Methods | Minimum org role | With the flag off |
|---|---|---|---|
| `/team` | GET, POST | GET/POST need auth; the management view needs `admin` | 404 |
| `/team/invites` | POST | `admin` | 404 |
| `/team/invites/:id/revoke` | POST | `admin` | 404 |
| `/team/members/:id/role` | POST | `admin` (`owner` to touch ownership) | 404 |
| `/team/members/:id/remove` | POST | `admin` (`owner` to remove an owner) | 404 |
| `/invites/accept` | GET, POST | none — the acceptor has no membership yet | 404 |

Routes are registered unconditionally in `src/server/routes/app.tsx`; each controller calls
`render404()` when `!teamsEnabled()`. A route existing tells you nothing about whether it answers
— the same contract the password-mode routes follow.

Schema is migration `008_add_organizations.ts`: an `organizations` table, three nullable columns
on `users` (`org_id`, `org_role`, `org_joined_at`), and an `organization_invites` table. The
migration runs in every fork; with the flag off nothing writes to any of it.

---

## 2. The two role axes

`users.role` is `'user' | 'admin'`. It means **platform operator**, it gates `/admin` through
`requireAdmin`, and this feature does not touch it.

`users.org_role` is `'owner' | 'admin' | 'member'`. It means **standing inside one
organisation**, and it gates `/team` through `requireOrgRole`.

They are deliberately not merged. A platform operator answering a support ticket is not thereby
an owner of a customer's organisation, and collapsing the two would make every support grant a
data grant. Concretely: widening the `users_role_check` constraint to hold org roles would make
"org owner who is not a platform admin" — the single most common user of this feature —
inexpressible.

The form field is named `org_role`, never `role`, so a copy-paste can never write a member's
input into `users.role` and hand them the admin console.

---

## 3. Turning it on

`TEAMS_ENABLED=true`. Anything other than `true` or `false` stops the server at boot, unlike
`CAPTCHA_ENABLED` — a typo here would silently 404 the whole surface, and an owner hitting a 404
on their own team page reads that as a bug rather than as a mode.

`teamsEnabled()` reads `process.env` on every call, so a test can flip it between cases.

**Enabling it over an existing database backfills nothing.** Every current user has no
membership and lands on the "create a team" empty state. That is deliberate: guessing that each
existing user should get a personal org would be wrong for most forks and awkward to undo.

**The test runner pins `TEAMS_ENABLED=false`** in `src/server/test-utils/run-tests.ts`, alongside
`SESSION_COOKIE_NAME`, `AUTH_MODE` and `CAPTCHA_ENABLED`. Without the pin, a developer who runs
the dev server with teams on leaks it into every test run. Files exercising teams set it
per-case.

---

## 4. Invitations

An invite is a row in `organization_invites` carrying the org, the address, the role it grants,
and an HMAC of a 32-byte token. Only the hash is stored — the raw value exists solely in the
email.

- **Lifetime: 7 days**, longer than any auth token. An invite grants org membership rather than
  a session or account takeover, it goes to someone who may be away, and unlike the auth tokens
  it can be revoked — so a long life is not an uncancellable one. Expiry is filtered at read
  time, not swept.
- **Single use**, claimed by one `UPDATE ... WHERE accepted_at IS NULL ... RETURNING`. Two
  concurrent clicks: exactly one wins.
- **Re-inviting is idempotent** — any live invite for that address is revoked and a fresh one
  issued in the same call, so a double-click produces a new working link, not an error. A partial
  unique index enforces at most one live invite per address per org.
- **Revoking an invite** and **removing a member** are separate operations on separate tables;
  both are scoped by `organization_id`.
- **Capped at 50 live invites per org**, and rate limited at 5/minute per IP. Invite creation is
  a mail-sending primitive exposed to authenticated users; a compromised owner account must not
  become a spam relay from your verified domain (see [EMAIL.md](EMAIL.md)).

### Why invites are not `user_tokens`

`user_tokens` is the generic single-use emailed-token table and its `type` column is
unconstrained, so an `org_invite` type looks like the obvious reuse. It was rejected.

`user_tokens.user_id` is `NOT NULL`, so an invite to an address with no account would have to
create a shell `users` row first. `findOrCreateUser` already does that for any address typed into
the magic-link login form — but it has exactly one production call site, `createMagicLink`, so in
**password mode nothing today lets a third party create a passwordless user row**. And
`signInWithPassword` reports `no-password` distinguishably from `invalid-credentials`, a
disclosure scoped to accounts carried over from magic-link mode. Minting shell rows from an
invite box would widen it to *any address an org admin ever typed*, turning `/login` into an
oracle for "this address was invited to something once".

Two lesser reasons: `consumeUserToken` returns a `user_id` and nothing else, so the org and role
have nowhere to live; and revoking would leave a permanent shell row behind.

### The address binding

An invite is bound to the address it was sent to. Accepting while signed in as **anyone else**
fails with `email-mismatch`, checked before the token is spent. Without it, forwarding the link
turns it into a join-anyone link. This is the single most important check in the accept flow.

### Accepting, in both auth modes

`GET /invites/accept` never consumes the token — it renders the team name and, in password mode,
decides whether to ask for a password. That decision is keyed on the **invited address**, not the
session, because most people accept while signed out.

- **Magic-link mode** — the emailed token is the credential, exactly as a magic link is, so
  accepting signs them in. The session is regenerated, never reused.
- **Password mode, new or passwordless account** — they choose a password in the same request
  and are signed in. The password is validated *before* the invite is consumed, so a typo doesn't
  burn a single-use token.
- **Password mode, existing password account** — they become a member but are **not** signed in;
  they're sent to `/login`. Control of a mailbox is grounds for a *reset*, never a sign-in, which
  is exactly why `/auth/verify` signs nobody in. An invite must not become a way around that.

Accepting sets `email_verified_at` in both modes: the token only ever reached a mailbox the
recipient could open.

---

## 5. The last-owner invariant

An org must always have at least one owner. This is a **guard, not a constraint** — SQL can
express *at most* one of something via a partial unique index, which is the opposite of what is
needed.

The guard lives **inside** the `UPDATE`, in `updateMemberRole` and `removeMember`:

```sql
AND (org_role <> 'owner' OR EXISTS (
      SELECT 1 FROM users WHERE org_id = $1 AND org_role = 'owner' AND id <> $2))
```

Zero rows back means it was refused. A check-then-write would let two owners each demote the
other in parallel and leave the org with nobody who can administer it.

The template also hides the control on the last owner's row — but **that is cosmetic**. The
server decides. If you add a new path to change roles, it must go through these functions.

---

## 6. Authorisation checklist for new team routes

1. Open the controller method with `if (!teamsEnabled()) return render404();`. `requireOrgRole`
   repeats the check as a backstop, but the line at the top is what a reader sees.
2. Call `requireOrgRole(req, minimum)` and return `result.response` when it refuses.
3. **Scope every `:id` lookup by the caller's org** — `WHERE id = $1 AND org_id = $2`, never by id
   alone. The guard proves you administer *an* org, not that the row you named is in it. Nothing
   else in the codebase catches this; it is the one authorisation bug class this feature adds.
4. Resolve not-found to a flash and a redirect, never a 404 — so "wrong org" and "already gone"
   stay indistinguishable.
5. Check body-dependent escalation (granting `owner`) against `result.membership.role`, in the
   controller. The guard can't: whether a POST is a promotion is only knowable after reading the
   body.
6. Give every form its own CSRF token. Tokens are bound to method **and** path, so a table of
   rows needs one per row — see `team.index` for the pattern.

---

## 7. Scoping your own data by org

Core stops at identity. `requireOrgRole` returns the resolved membership, so
`result.membership.org.id` is available in every guarded controller — that is the seam.

```ts
const guard = await requireOrgRole(req, "member");
if (!guard.authorized) return guard.response;

const invoices = await listInvoices(guard.membership.org.id);
```

For a page outside the team surface, call `getMembership(userId)` directly.

To scope a table of your own: add `org_id UUID REFERENCES organizations(id)` in a new migration,
put it in the `WHERE` clause of every read *and* every write, and add the table to
`cleanupTestData`. Scope in the service, not the controller — a query that can be called without
the predicate eventually will be.

---

## 8. Deliberately not shipped, and why

- **Core does not scope domain data by org.** The `project` table has no `org_id` and
  `services/project.ts` is untouched. What "belongs to" an org is product-specific — some rows
  are per-user, some per-org, some global — so a guessed column on the example table would be
  wrong for most forks and load-bearing enough that removing it is worse than adding it. Use the
  seam in §7.
- **No multi-org membership and no org switcher.** One user, one org. Multi-org means a switcher,
  a current-org value on the session, and re-scoping every query — a different feature. The
  one-org rule is enforced by `joinOrganization` and `createOrganizationForUser` guarding on
  `org_id IS NULL`.
- **No read-only roster for plain members.** `/team` requires `admin`. Lower the minimum at the
  call site and branch the template if your product wants one.
- **No ownership transfer as a single action.** An owner can promote another owner and then leave;
  there is no atomic "transfer and go".
- **No `?next=` on `/login`.** A signed-out invitee is told to sign in and re-open the link. A
  post-login redirect parameter is an open-redirect footgun and would touch the auth flow
  directly; a fork adding one must allowlist paths rather than accept arbitrary URLs.
- **No audit log.** Role changes and removals aren't recorded beyond application logs.
- **No seat limits, billing, SSO, SCIM, nested teams, or custom permission sets.**

---

## 9. How to verify

With `TEAMS_ENABLED=true`:

1. Sign up, land on `/team`, create a team — you're the owner.
2. Invite an address; read the link from the console email provider's log; open it in a private
   window and accept. The member appears with the role you granted.
3. Sign in as a plain `member` and open `/team` — you're redirected to `/` with a message, not
   shown the page and not 404'd.
4. As the only owner, try to demote or remove yourself. Both are refused with a flash. Then post
   to `/team/members/:id/role` directly with a valid token to confirm the *server* refuses it,
   not just the hidden button.
5. Take a member id from another org and post it to your own org's role endpoint. Nothing changes.
6. Forward an invite link and open it while signed in as someone else. It must refuse.
7. Repeat step 2 with `AUTH_MODE=password`, twice: once for an address with no account (it asks
   for a password and signs them in) and once for an address that already has one (it joins them
   and sends them to `/login` **without** a session).
8. Unset the flag: `/team` and `/invites/accept` 404 and nothing else changes.
