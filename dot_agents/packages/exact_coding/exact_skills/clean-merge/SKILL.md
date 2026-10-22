---
name: clean-merge
description:
  Merges any branches / worktrees to main or master locally and clean up.
disable-model-invocation: true
---

Merge the branch / worktree back to the canonical branch, e.g. main or master,
locally and clean up.

## Terminal cleanup

Removing the active worktree invalidates the agent's working directory. A shell
`cd` does **not** relocate the agent itself; later tool calls can fail before
their commands start.

For a linked worktree in a Herdr pane:

1. Complete the merge and verify the merged result before cleanup.
2. Capture the absolute canonical checkout and worktree paths, feature branch,
   and pane ID while the worktree exists. Confirm the canonical checkout is
   outside the worktree being removed.
3. Report verification results and announce cleanup; do not claim cleanup has
   succeeded yet.
4. In **one final Bash tool call**, set the captured values and execute:

   ```sh
   cd "$MAIN_ROOT" &&
   git worktree remove "$WORKTREE_PATH" &&
   git branch -d "$FEATURE_BRANCH" &&
   herdr pane close "$HERDR_PANE_ID"
   ```

Shell variables do not persist between tool calls. Supply their values in that
final call. Do not split removal and pane closure across calls or schedule any
further tools after removal. Do not force removal if Git refuses cleanup.

If the session must remain usable, relocate the agent through a supported
harness mechanism before removal, or retain the worktree and report it. Merely
using `git -C` or running `cd` in a subprocess does not relocate the agent.

When no active worktree is being removed, close the Herdr pane as the final
operation with `herdr pane close "$HERDR_PANE_ID"`.
