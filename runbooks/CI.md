# CI & merge protection Runbook

Billet runs lint, type-check, build, and the full test suite on every pull
request via GitHub Actions ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)),
plus a dependency audit on its own schedule
([`.github/workflows/audit.yml`](../.github/workflows/audit.yml)).
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

**Every job pins Bun** via `bun-version-file: .bun-version`. Without it
`oven-sh/setup-bun` installs the latest release, which means the toolchain under
CI changes on Bun's release schedule rather than on a commit — and this app is
built on `Bun.SQL`, `Bun.password`, and Bun's CSS bundler, so a build can go red
with nothing in the diff to explain it. `.bun-version` and the `engines.bun`
floor in `package.json` are the same number; bump both together, in a commit
whose CI run is the evidence the new version works.

> **The `Tests` job env is deliberately generic** — `APP_NAME: CI Test`, with
> `POSTGRES_DB` / `DATABASE_URL` on `ci-test` — so a fork inherits nothing it has
> to rename. Tests read `APP_NAME` from the environment rather than asserting a
> literal, so changing it is safe if you'd rather see your own name in CI output.

The `Tests` job is tuned in two ways a fork should keep:

- **The Postgres cluster runs in RAM** (`PGDATA: /dev/shm/pgdata`, plus
  `--shm-size=1g` so the container has room for it). `cleanupTestData` truncates
  between tests, and on a runner's disk each truncate waits on an fsync — a
  runner was ~13× slower than a laptop before this. Test data is disposable, so
  the durability those fsyncs bought was worth nothing.
- **`TEST_FILE_TIMEOUT_MS: "180000"`** raises the per-file cap in
  `src/server/test-utils/run-tests.ts` from its 60s default. That cap exists to
  catch a hung file, not to enforce a speed: a runner is slower than a laptop
  even with the database in RAM, and a file killed at the wire counts every test
  in it as lost — which reads as a broken test rather than the timing accident it
  is.

## 1b. The dependency audit

`bun audit` checks the installed tree against the npm advisory database.
It lives in **its own workflow** rather than as a fourth job in `ci.yml`, because
`bun install --frozen-lockfile` installs the same tree every run — what changes
between runs is the advisory database, not this repository. That needs a clock,
not a commit:

| Trigger | Why |
|---|---|
| `pull_request` | A PR that adds or bumps a dependency is checked before it lands |
| `schedule` (Mondays 07:00 UTC) | A new advisory against an *existing* pin shouldn't wait for someone to open a PR |
| `workflow_dispatch` | Run it on demand after a security bulletin |

It runs `bun run audit`, i.e. `bun audit --audit-level=high`. **The threshold is
deliberate**: a low or moderate advisory in a transitive devDependency is worth
knowing about but not worth blocking an unrelated PR over, and a check that goes
red for reasons nobody can act on is a check people learn to ignore. Run plain
`bun audit` locally to see everything, including what sits below the line.

When it does fail, the fix is usually `bun update <package>` — a compatible bump
inside the existing range, so the lockfile changes and nothing else does. If the
advisory is against a transitive dependency of a direct one (say `resend` →
`svix` → `uuid`), you can't bump it yourself; either the direct dependency ships
an update or you decide the exposure is acceptable and record why.

Dependabot ([`.github/dependabot.yml`](../.github/dependabot.yml)) opens the
routine bumps — one grouped PR a week for dependencies, one for pinned Action
versions — so the audit is the backstop, not the mechanism.

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
  build without lifting it first (see §5).
- **`strict: false`** — merge as soon as checks are green. Set `true` to also
  require the branch be up to date with `main` first (safer, but forces a
  rebase/re-run whenever `main` moves).
- **No required reviews** — this gates on CI only; it doesn't add an approval
  requirement.

## 3. Enable auto-merge (optional)

Once §2 is in place, GitHub's native **auto-merge** becomes safe: you arm a PR
up front and GitHub merges it the moment every required check goes green,
without you babysitting the build. Like branch protection, it's a **repo
setting a fork does not inherit** — new clones ship with it off.

It's a two-layer feature:

**Layer 1 — allow it on the repo** (Settings → General → Pull Requests →
"Allow auto-merge"), or via API:

```bash
gh api -X PATCH repos/{owner}/{repo} -F allow_auto_merge=true
```

**Layer 2 — arm it on a PR.** This is what invokes the `enablePullRequestAutoMerge`
GraphQL mutation under the hood:

```bash
gh pr merge <number> --auto --squash   # --squash: the repo allows squash + rebase, not merge commits
```

The PR then reports `mergeStateStatus: BLOCKED` until the required contexts
report success, at which point GitHub merges it automatically. With
`delete_branch_on_merge` already enabled, the branch is cleaned up on merge too.

- **Auto-merge without §2 is pointless — and risky.** If no checks are required,
  there's nothing to wait on: GitHub either merges immediately or rejects the
  `--auto` request. The required-checks gate is what makes "merge when green"
  mean anything.
- **Disable the capability** with `-F allow_auto_merge=false`; **cancel** a single
  armed PR with `gh pr merge <number> --disable-auto`.

## 4. Verify

A PR whose required checks haven't all passed reports `BLOCKED`:

```bash
gh pr view <number> --json mergeable,mergeStateStatus
# mergeStateStatus: "BLOCKED"  → held on required checks (auto-merge can't complete)
# mergeStateStatus: "CLEAN"    → all required checks green, mergeable
```

`mergeable: MERGEABLE` only means "no merge conflicts" — it's `mergeStateStatus`
that reflects the check gate.

## 5. Adjust or remove

```bash
# Let admins hand-override a red build (turn enforce-admins off):
gh api -X DELETE repos/{owner}/{repo}/branches/main/protection/enforce_admins

# Re-enable it:
gh api -X POST repos/{owner}/{repo}/branches/main/protection/enforce_admins

# Remove all protection:
gh api -X DELETE repos/{owner}/{repo}/branches/main/protection
```

## 6. Gotchas

- **Branch protection is a GitHub repo setting, not code.** It lives on the
  remote, not in this repository, so it is not copied when someone forks or
  re-clones. Each repo that wants gated merges must run §2 once.
- **Contexts must match job names exactly.** If you rename a job in `ci.yml`
  (e.g. `Tests` → `Test suite`), update the required `contexts` to match — a
  required check that never reports keeps every PR blocked forever.
- **New checks aren't auto-required.** Adding a job to `ci.yml` doesn't make it
  blocking; add its name to `contexts` if it should gate merges.
- **`Dependency audit` is not in the §2 contexts list.** That's a choice, not an
  oversight: it runs on a schedule as well as on PRs, and a required check that
  can start failing because of something outside the PR will block every open
  branch at once. Add `"Dependency audit"` to `contexts` if you'd rather no PR
  merge while a high-severity advisory is outstanding.
