---
name: clean-merge
description:
  Merges any branches / worktrees to main or master locally and clean up.
disable-model-invocation: true
---

Merge the branch / worktree back to the canonical branch, e.g. main or master,
locally and clean up.

## Worktree and branch cleanup

After verifying the merge, remove the linked worktree and delete the merged
feature branch before closing your multiplexer pane.

Removing the active worktree invalidates the agent's working directory. A shell
`cd` does **not** relocate the agent itself; later tool calls can fail before
their commands start.

For a linked worktree in a multiplexer pane:

1. Complete the merge and verify the merged result before cleanup.
2. Capture the absolute canonical checkout and worktree paths and the feature
   branch while the worktree exists. Confirm the canonical checkout is outside
   the worktree being removed.
3. Report verification results and announce cleanup; do not claim cleanup has
   succeeded yet.
4. In **one final Bash tool call**, set the captured values and execute:

   ```sh
   cd "$MAIN_ROOT" &&
   git worktree remove "$WORKTREE_PATH" &&
   git branch -d "$FEATURE_BRANCH" &&
   close
   ```

   `close` closes your Rex or Herdr pane; see the `close` skill.

### `wt` sandboxes

If `git config --get "branch.$FEATURE_BRANCH.wt"` succeeds, the branch is a `wt`
sandbox. Merge into its recorded `base`, not main or master, and let `wt` merge
and clean up in one step. Because `wt merge` also removes the sandbox, verify
the sandbox before merging. Capture `MAIN_ROOT` with `command wt cd "$BASE"`.
The final call is:

```sh
cd "$MAIN_ROOT" &&
wt merge "$FEATURE_BRANCH" &&
close
```

If `wt merge` refuses or conflicts, follow the recovery steps in its error and
in `docs/wt.md`; do not fall back to manual removal.

Shell variables do not persist between tool calls. Supply their values in that
final call. Do not split removal and pane closure across calls or schedule any
further tools after removal. Do not force removal if Git refuses cleanup.

If the session must remain usable, relocate the agent through a supported
harness mechanism before removal, or retain the worktree and report it. Merely
using `git -C` or running `cd` in a subprocess does not relocate the agent.

## Terminal cleanup

If you're on a multiplexer and no worktree removal closed it, close your pane
with the `close` skill.

Close only your own pane, as the final operation after worktree and branch
cleanup. When removing the active worktree, include this command in the same
final tool call as shown above, not in a subsequent call.
