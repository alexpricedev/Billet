# CI & merge protection Runbook

Billet runs lint, type-check, build, and the full test suite on every pull
request via GitHub Actions ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)).
But **CI results only gate merges if you make the checks _required_** — that's a
per-repository GitHub setting that a fork or new clone does **not** inherit.
Until you set it, a PR is mergeable the moment it opens, and any auto-merge
(GitHub's native one _or_ Conductor's Automerge button) will merge it regardless
of whether the tests passed.

This runbook covers the pipeline and how to lock merges behind green CI.

## 1. What runs on every PR

Three jobs, chained so a failure short-circuits the rest:

| Check (job name) | Command | Depends on |
|---|---|---|
| `Lint & Typecheck` | `bun run check` | — |
| `Build` | `bun run build` | `Lint & Typecheck` |
| `Tests` | `bun run test` against a Postgres service | `Build` |

The job **names** above are exactly the check "contexts" GitHub sees — you'll
reference them by name in §2.

> **Rename the placeholder env.** The `Tests` job in `ci.yml` still ships with
> template values (`APP_NAME: San Jose`, `POSTGRES_DB` / `DATABASE_URL` pointing
> at `san-jose-test`). They're internally consistent so tests pass, but rename
> them to your project for clarity.

## 2. Require the checks before merge

By default GitHub treats check results as **advisory** — informational, not
blocking. Auto-merge tools (Conductor included) merge by calling GitHub's merge
API with your credentials, and **GitHub only rejects a merge when the target
branch has required status checks**. So the fix is server-side and tool-agnostic:
require the checks on your default branch, and _every_ merge path is gated by
them.

This also closes a race worth knowing about: because the jobs are chained, when a
PR first opens only `Lint & Typecheck` exists as a check — `Build` and `Tests`
haven't registered yet. An auto-merge that acts on "the checks I can see are
green" could merge after lint and before Tests ever runs. Requiring all three
names means GitHub holds the merge until each required context reports success.

Apply the rule (the `{owner}`/`{repo}` placeholders resolve from the current
clone, so this is copy-paste safe in any fork):

```bash
gh api -X PUT repos/{owner}/{repo}/branches/main/protection --input - <<'JSON'
{
  "required_status_checks": { "strict": false, "contexts": ["Lint & Typecheck", "Build", "Tests"] },
  "enforce_admins": true,
  "required_pull_request_reviews": null,
  "restrictions": null
}
JSON
```

- **`enforce_admins: true`** — the required checks apply to _everyone_, including
  repo admins and the token an auto-merge acts under. This is the part that
  actually stops a premature merge. Trade-off: you can't hand-override a red
  build without lifting it first (see §4).
- **`strict: false`** — merge as soon as checks are green. Set `true` to also
  require the branch be up to date with `main` first (safer, but forces a
  rebase/re-run whenever `main` moves).
- **No required reviews** — this gates on CI only; it doesn't add an approval
  requirement.

## 3. Verify

A PR whose required checks haven't all passed reports `BLOCKED`:

```bash
gh pr view <number> --json mergeable,mergeStateStatus
# mergeStateStatus: "BLOCKED"  → held on required checks (auto-merge can't complete)
# mergeStateStatus: "CLEAN"    → all required checks green, mergeable
```

`mergeable: MERGEABLE` only means "no merge conflicts" — it's `mergeStateStatus`
that reflects the check gate.

## 4. Adjust or remove

```bash
# Let admins hand-override a red build (turn enforce-admins off):
gh api -X DELETE repos/{owner}/{repo}/branches/main/protection/enforce_admins

# Re-enable it:
gh api -X POST repos/{owner}/{repo}/branches/main/protection/enforce_admins

# Remove all protection:
gh api -X DELETE repos/{owner}/{repo}/branches/main/protection
```

## 5. Gotchas

- **Branch protection is a GitHub repo setting, not code.** It lives on the
  remote, not in this repository, so it is not copied when someone forks or
  re-clones. Each repo that wants gated merges must run §2 once.
- **Contexts must match job names exactly.** If you rename a job in `ci.yml`
  (e.g. `Tests` → `Test suite`), update the required `contexts` to match — a
  required check that never reports keeps every PR blocked forever.
- **New checks aren't auto-required.** Adding a job to `ci.yml` doesn't make it
  blocking; add its name to `contexts` if it should gate merges.
