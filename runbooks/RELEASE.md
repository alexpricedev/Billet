# Release Runbook

Billet is consumed by cloning or forking this repository, not by installing from
npm. A fork gets no dependency bump, no changelog notification, and no upgrade
prompt — **the tag, `CHANGELOG.md` and `.billet-version` are the only upgrade
signals it has.** Everything below exists because a fork reading them months from
now has nothing else to go on.

## 1. The shape: two pull requests, never one

A release is its own PR, opened after the feature PR has merged:

```
#84  Close the Content-Signal posture when indexing is off   ← runbooks + src + tests
#85  Release 5.0.1: the Content-Signal follows ALLOW_INDEXING ← three files, nothing else
```

The release PR touches **exactly three files**:

| File | What changes |
|---|---|
| `CHANGELOG.md` | A new `## X.Y.Z` section at the top, above the previous one |
| `package.json` | `version` |
| `.billet-version` | The version line at the bottom; the comment above it never changes |

**A feature PR touches none of them.** This is the rule worth internalising,
because the failure mode is adding them, not forgetting them: a `## 5.1.0`
heading written on a feature branch claims a version that does not exist, and
leaves the three files disagreeing until someone notices. If you have changelog
prose ready while the feature is still in review, park it somewhere untracked
(`.context/`) and bring it to the release PR.

The split is not ceremony. It keeps the feature PR reviewable as a change to the
software, and it means the version is decided once, against what actually landed
on `main`, rather than guessed at while review is still moving the diff.

## 2. Choosing the number

Semver, with one local definition that matters more than the others:

- **Major** — a fork has to change its own code after merging. Not "this is a big
  feature": the test is whether someone who merged this into their own tree would
  find their code broken. `5.0.0` was a major because four templates gained a
  prop their controllers had to pass.
- **Minor** — new capability, nothing a fork must change.
- **Patch** — a fix to behaviour already shipped.

When in doubt, ask what a fork has to *do*. If the answer is nothing, it is not a
major, however large the diff.

## 3. Writing the `CHANGELOG.md` entry

The shape, observed across every release and worth keeping:

```markdown
## 5.0.1

One or two paragraphs of prose: what changed, and the situation that made the old
behaviour wrong. Written for someone who was not in the PR.

**No migration, and no fork has code to change.** — or, when there is:

### Breaking changes

- **What a fork must change in its own tree**, and what it will look like if they
  don't.

### Added / ### Changed / ### Fixed

- **A bolded claim**, then the detail and the reasoning. Name the file.
```

Two rules the file's own preamble commits to:

- **Anything that can silently break a fork after a merge goes under
  `### Breaking changes`.** Silently is the operative word — a fork that merges
  and sees a failing test will investigate; one whose app keeps booting with
  subtly different behaviour will not.
- **Every release says what a fork must change, even when the answer is
  nothing.** "No migration, and no fork has code to change" is a sentence worth
  writing, because its absence is indistinguishable from an oversight.

Write the reasoning, not just the change. A fork reading this in six months is
deciding whether they need it, and the diff is already in the tag.

## 4. `.billet-version`

One version line at the bottom; everything above it is comment, and that comment
is load-bearing — it carries the `curl` commands a fork uses to find upstream's
tags and CHANGELOG without adding a remote. Rewrite the version line only.

It is deliberately separate from `package.json`'s `version`, which belongs to
whoever forked this and is theirs to bump. `.billet-version` answers a different
question — *which Billet is this tree built on?* — and without it, deciding
whether an upstream fix is already present means diffing source against a repo
the fork may not have as a remote. With it, `git log <tag>..HEAD -- <path>`
settles it.

See the `.billet-version` gotcha in `CLAUDE.md` for why it survives a rename.

## 5. Tag and publish

After the release PR merges to `main`:

1. Tag the release commit — `v` prefix, on `main`:
   ```bash
   git tag v5.1.0 <release-commit>
   git push origin v5.1.0
   ```
2. Publish a GitHub release on that tag. Title is `vX.Y.Z — <the subtitle from
   the PR title>`, lowercase after the dash:

   > `v5.0.1 — the Content-Signal follows ALLOW_INDEXING`

3. The body is the CHANGELOG prose, reflowed to single-line paragraphs, then a
   `### Note for forks` section saying what a fork must do, then:

   ```markdown
   Full notes: [CHANGELOG.md](https://github.com/alexpricedev/Billet/blob/main/CHANGELOG.md#511)
   ```

   The anchor is the version with the dots removed.

The release notes and the changelog entry say the same thing twice on purpose.
The notes are what a fork sees in their watch feed; the changelog is what they
read when they are already in the tree deciding whether to merge.

## 6. Checklist

- [ ] Feature PR merged to `main` first, carrying none of the three files
- [ ] Version chosen by "does a fork have to change its own code?", not by diff size
- [ ] `CHANGELOG.md` entry added at the top, with `### Breaking changes` or an
      explicit statement that there are none
- [ ] `package.json` `version` bumped
- [ ] `.billet-version`'s version line rewritten, comment untouched
- [ ] Release PR contains those three files and nothing else
- [ ] CI green (`runbooks/CI.md` — the checks are advisory until required)
- [ ] Tag `vX.Y.Z` pushed on the merged release commit
- [ ] GitHub release published with a `### Note for forks` section
