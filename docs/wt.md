# wt

A Python 3.9+ / Git CLI for temporary worktrees, installed by chezmoi as
`~/.local/bin/wt`. No third-party Python dependencies.

```sh
wt new feature                  # create from current branch and enter the sandbox
wt new another --base release    # explicitly select a local base branch
wt merge                         # merge current sandbox into its recorded base, then clean up
wt remove                        # clean up only if merged into the recorded base
wt remove --force                # discard unmerged commits and uncommitted files
```

`merge` and `remove` also accept a branch name, so they can be run from any
checkout of the same repository. The Bash/Zsh `wt` function automatically changes
directory after successful creation. Reload it in an existing shell with
`source ~/.bash_aliases`; new interactive shells load it automatically.

Prefer running cleanup from a surviving checkout:

```sh
wt new feature
# Work and commit in the sandbox.
cd -
wt merge feature
```

## Contract

- `new` creates a new local branch and a `wt-*/repo` directory under the system
  temporary directory (`TMPDIR` is honored). The shell wrapper enters that
  directory only if creation succeeds. Help and other commands are forwarded
  unchanged. Existing branches are rejected.
- For scripting without changing directories, `command wt new feature` bypasses
  the shell wrapper and prints only the absolute path to stdout. The executable
  itself cannot change its parent shell's directory.
- The current branch is the default base even in another sandbox. Detached HEAD
  requires `--base`. No special treatment of `main` or `master`; no fetch, pull,
  or push. Uncommitted changes in the starting checkout are not copied.
- Local Git config stores `branch.<name>.wt` as JSON with `base` (local branch
  name) and `path` (absolute checkout path). Git remains the source of truth for
  branches and registered worktrees; there is no external registry.
- `merge` requires the recorded base to be checked out exactly once and both
  checkouts to be clean, with no merge/rebase/cherry-pick/bisect in progress.
  It uses `git merge --no-ff` with a Conventional Commit message. If already
  merged, Git does not create an extra commit. Cleanup happens only on success.
- Normal removal requires the branch tip to be an ancestor of the recorded
  base, plus a clean worktree. Tracked changes and untracked files are protected.
  **Ignored files (such as build outputs) are disposable and removed**, matching
  normal Git worktree removal behavior.
- `--force` bypasses ancestry and dirty-state checks, including a missing base.
  It does not permit deleting the original checkout, unmanaged worktrees,
  locked/missing worktrees, mismatched paths, or branches still recorded as the
  base of another sandbox. Clean up children before their parents.
- Cleanup removes the registered worktree, its local branch and branch config,
  then its empty sandbox container. Unexpected files outside `repo` are retained
  rather than recursively deleted.

## Recovery and limits

On merge conflict, nothing is cleaned up. Resolve and commit in the **base
checkout**, then run `wt remove <branch>`. Alternatively, run `git merge --abort`
in the base checkout and retry later.

If creation partially fails, inspect the reported sandbox and Git worktree list;
no recursive rollback deletes possible hook-created work. If metadata cannot be
written, the worktree remains for manual recovery. A failed cleanup preserves
whatever has not yet been removed and reports the error.

Do not rename or move managed branches/worktrees without updating their local
Git metadata. A missing or stale record fails closed; repair it explicitly.
Do not run simultaneous lifecycle operations against the same sandbox or edit it
while it is being removed. Initialized submodules can require manual cleanup.

Temporary storage can be purged by the OS. Keep valuable work committed and
backed up. Worktrees share a Git repository; this is filesystem convenience,
**not a security sandbox**.

## Verification

```sh
bash tests/wt-shell.test.sh      # fake-backed shell navigation tests
zsh tests/wt-shell.test.sh
python3 tests/wt.test.py         # deterministic fake-backed unit tests
python3 docs/qa/wt.py            # discretionary real-Git QA; never CI/pre-commit
```
