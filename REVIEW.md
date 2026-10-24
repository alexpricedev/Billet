# REVIEW.md

## What failure looks like

- A page a signed-out visitor shouldn't see: a route missing `requireAdmin` or `requireOrgRole`, or a team `:id` not scoped by `user_id` and `organization_id`.
- A migration that can't roll back: no working `down`.
- A form that loses what someone typed: a failed POST that doesn't preserve the input (never a password).

## Nit cap

At most three nits per review; style and naming are not findings unless a convention in CLAUDE.md says so.

## Skip

- `bun.lock`
- `dist/**`
- `public/**`
- `ux/**`

## Evidence

Every finding names a file and line and quotes what's wrong there; nothing inferred from a name.

## Summary

Starts with a count; says "nothing to fix" plainly when that's true.
