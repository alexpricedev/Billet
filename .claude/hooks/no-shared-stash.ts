/**
 * PreToolUse hook: refuse `git stash` in favour of the per-worktree WIP tool.
 *
 * Every Conductor workspace is a worktree over one shared .git directory, and
 * refs/stash lives in that shared directory. `git stash` in one workspace pushes
 * onto the same stack another agent pops from, so parallel agents silently
 * restore each other's changes. `scripts/wip` uses refs/worktree/*, which git
 * keeps per-worktree, and has no such collision.
 */

export type HookInput = {
  tool_name?: string;
  tool_input?: { command?: string };
};

const GUIDANCE = `git stash is unsafe here: this repo is checked out as multiple git worktrees that share one .git directory, so refs/stash is a single global stack. Another agent's stash can be popped by you, and yours by them.

Use the per-worktree equivalent instead — snapshots are stored under refs/worktree/wip and are invisible to every other workspace:

  bun run wip save [message]   snapshot tracked changes, working tree untouched
  bun run wip stash [message]  snapshot, then revert tracked changes
  bun run wip list             list this worktree's snapshots
  bun run wip restore [n]      re-apply snapshot n (default 0)
  bun run wip drop             forget the newest snapshot`;

const deny = (reason: string): never => {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
};

const input = (await Bun.stdin.json().catch(() => ({}))) as HookInput;

if (input.tool_name === "Bash") {
  const command = input.tool_input?.command ?? "";

  // Strip quoting so `git "stash"` and `git 'stash'` are caught too.
  const normalised = command.replace(/["']/g, "");

  // Anything already aimed at the per-worktree namespace is what we want people
  // doing. `git stash create` is safe on its own — it writes a dangling commit
  // and never touches refs/stash, which is exactly how `scripts/wip` builds a
  // snapshot.
  const perWorktree =
    normalised.includes("refs/worktree/") ||
    /\bgit\s+stash\s+create\b/.test(normalised);

  // Tolerate global options ahead of the subcommand: `git -c foo=1 stash pop`,
  // `git --git-dir=... stash list`.
  if (!perWorktree && /\bgit\s+(?:-\S+\s+|\S+=\S+\s+)*stash\b/.test(normalised)) {
    deny(GUIDANCE);
  }
}

process.exit(0);
