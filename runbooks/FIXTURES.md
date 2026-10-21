# Fixtures

A fixed cast of people and data, so an agent can sign in as a persona and walk the stories in
`ux/stories/` against the same state every time. `ux/personas.md` is the source of truth; the
code is `src/server/fixtures/personas.ts`, and `personas.test.ts` fails if the two disagree.

## Load them

```
bun run fixtures
```

This **truncates every app table** in the database `DATABASE_URL` names (it prints the name first)
and loads Northwind (Priya owner, Ade admin, Tom member), Jo with no team, Morgan as platform
admin, Zofia's pending invite and four todos — a done one, a 200-character one, one with emoji,
and one with no owner. It runs in one transaction, and ids and timestamps are fixed, so two loads
produce identical rows.

The dev database is shared with whoever has the browser open: loading signs them out and replaces
their rows. It refuses to run with `NODE_ENV=production`, and unless the `DATABASE_URL` host is
`localhost`, `127.0.0.1` or `::1` — `NODE_ENV` is usually unset on a laptop, so a `.env` pointing at
a hosted database would otherwise be wiped. `FIXTURES_ALLOW_REMOTE=1` is the explicit override.

Zofia has no account — she is invited, not joined, and starts signed out (story 06). The command
prints her accept link; it is the same after every load.

## Sign in as a persona

```
bun run scripts/persona-session.ts priya     # priya | ade | tom | jo | morgan
```

Prints `<cookie>=<session>` on stdout, like `scripts/qa-session.ts`, for a browser or `curl`.
Run `fixtures` first; a persona that isn't loaded says so. `sam` (guest) and `zofia` have no
account and so no session. Same production and remote-database refusals.

## Password mode

Every account except Jo has the password `fixture-password-1234` (`FIXTURE_PASSWORD`), so with
`AUTH_MODE=password` personas can also sign in through the form. Jo has no password, no verified
email and no team: the account with no optional fields. The password is public — dev and test only.
Set `TEAMS_ENABLED=true` for the team stories.

## In a fork

Edit `src/server/fixtures/personas.ts` (people, org, invite, todos) and `ux/personas.md`
together, and extend `load.ts` for any table you add. If you change `FIXTURE_PASSWORD`, recompute
`FIXTURE_PASSWORD_HASH` — the hash is a constant so loads stay identical; the test checks they match.
