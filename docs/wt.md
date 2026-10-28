# wt

A Python 3.9+ / Git CLI for temporary worktrees, installed by chezmoi as
`~/.local/bin/wt`. No third-party Python dependencies.

```sh
wt list                         # list every worktree in this repository
wt cd feature                   # enter an existing checkout by exact branch name
wt new feature                  # create from current branch and enter the sandbox
wt new "Foo Bar"                 # branch foo-bar, tab/window title Foo Bar
wt new another --base release    # explicitly select a local base branch
wt merge                         # merge current sandbox into its recorded base, then clean up
wt remove                        # clean up only if merged into the recorded base
wt remove --force                # discard unmerged commits and uncommitted files
wt clear                         # remove all merged, clean managed sandboxes in this repository
wt clear --force                 # discard all this repository's managed sandboxes
```

`merge` and `remove` also accept a branch name, so they can be run from any
checkout of the same repository. The Bash/Zsh `wt` function automatically changes
directory after successful creation or navigation. Reload it in an existing shell with
`source ~/.bash_aliases`; new interactive shells load it automatically.

Prefer running cleanup from a surviving checkout:

```sh
wt new feature
# Work and commit in the sandbox.
cd -
wt merge feature
```

## Contract

- `new` creates a new local branch and a `wt-<branch>` checkout directly beneath
  `~/.cache/wt`, or `$XDG_CACHE_HOME/wt` when `XDG_CACHE_HOME` is absolute. Slashes
  in the branch name become hyphens in the directory name. If the path already
  exists, creation is rejected, including collisions with other repositories. The
  shared root is created with mode 700; an existing non-private, foreign-owned,
  or symlink root is rejected. The shell wrapper enters the new directory only
  if creation succeeds. Existing branches are rejected. `TMPDIR` no longer
  controls sandbox placement. Names are lowercased and whitespace runs become
  hyphens (surrounding whitespace is discarded): `"Foo Bar"` creates `foo-bar`.
  The original name is saved for the tab/window title. Empty or invalid branch
  names and collisions after normalization are rejected; other Git-valid
  characters such as `/` are preserved. `cd`, `merge`, `remove`, and `--base`
  still use exact branch names.
- `list` prints branch and path columns separated by a tab. It includes the
  original checkout, unmanaged worktrees, and detached worktrees (labeled
  `(detached)`). It lists worktrees, not branches without checkouts.
- `cd <branch>` enters the existing checkout for an exact local branch name.
  Unknown branches, branches without checkouts, ambiguous checkouts, and missing
  directories produce a readable error without changing directory. It never
  creates a worktree or switches a checkout's branch. Dirty and locked checkouts
  remain navigable. Detached worktrees can be entered by their listed path using
  ordinary shell `cd`.
- For scripting without changing directories, `command wt new feature` and
  `command wt cd feature` bypass the shell wrapper and print only the absolute
  path to stdout. Help and non-navigation commands are forwarded unchanged.
  The executable itself cannot change its parent shell's directory.
- After successful `new` or `cd`, shell integration renames the calling Rex
  window or Herdr tab to the saved display name, falling back to the checked-out
  branch for older or unmanaged worktrees. It resolves the live tab from
  the calling pane, never from UI focus. Inside Herdr nested in Rex, only Herdr
  is renamed. Missing context/tools and API errors do not fail navigation;
  multiplexer calls time out after two seconds each. No renaming occurs for
  help, listing, failed navigation, or direct `command wt` calls.
- The current branch is the default base even in another sandbox. Detached HEAD
  requires `--base`. No special treatment of `main` or `master`; no fetch, pull,
  or push. Uncommitted changes in the starting checkout are not copied.
- Local Git config stores `branch.<name>.wt` as JSON with `base` (local branch
  name), `path` (absolute checkout path), and `name` (original display name).
  Older records without `name` remain supported. Git remains the source of truth for
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
  locked/missing worktrees, or mismatched paths. Single removal also refuses
  branches still recorded as the base of another sandbox; remove children first.
- `clear` operates only on this repository's locally recorded `wt` sandboxes.
  The original checkout, unmanaged branches/worktrees, and other repositories'
  sandboxes are untouched. Every candidate is checked before any deletion;
  nested bases are cleared children-first. Unmerged/dirty candidates and
  initialized submodules abort the whole preflight unless `--force` is supplied.
  Force also discards initialized submodules and their local work. Cyclic metadata
  is always refused.
  An empty batch succeeds. If an unexpected Git/filesystem failure occurs during
  deletion, clear stops; already-completed deletions are not rolled back.
- Cleanup removes the registered worktree, its local branch and branch config.
  The shared cache root itself is always retained. Legacy `wt-*/repo` sandboxes
  remain manageable, including those outside the cache; they are not relocated.
  Only their empty `wt-*` container is removed afterward; unexpected files
  outside `repo` are retained rather than recursively deleted.

## One-time Pi trust

From a newly created worktree, start Pi and run `/trust`. Select **Trust parent
folder** for `~/.cache/wt` (or `$XDG_CACHE_HOME/wt`). New worktrees sit directly
under that shared root, so trusting it covers future worktrees too.

For an existing legacy `wt-*/repo` checkout, the immediate parent is still its
random `wt-*` container. Instead, start Pi from the shared root and select
**Trust** there:

```sh
cd "${XDG_CACHE_HOME:-$HOME/.cache}/wt"
pi
```

If `XDG_CACHE_HOME` is relative, use `~/.cache/wt` instead.

This trusts project resources from **every repository placed under that root**.
Only use it for code you intend to trust. `wt` does not modify Pi's trust store,
change global trust defaults, or trust the system temporary directory. Legacy
sandboxes outside this root do not inherit this decision.

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
while it is being removed. Normal removal refuses initialized submodules;
inspect their work before choosing force removal.

There is no automatic TTL: `wt` removes sandboxes only through explicit merge,
remove, or clear commands. External cache cleaners can still remove cache data,
so keep valuable work committed and backed up. Worktrees share a Git repository;
this is filesystem convenience, **not a security sandbox**.

## Verification

The ordinary QA script strips inherited multiplexer context so it cannot rename
live tabs. The separate Rex QA explicitly changes and restores this tab's label.
Herdr behavior is tested against fakes matching its bundled API schema; live
verification requires running inside Herdr.

```sh
bash tests/wt-shell.test.sh      # fake-backed shell navigation tests
zsh tests/wt-shell.test.sh
python3 tests/wt.test.py         # deterministic fake-backed unit tests
python3 docs/qa/wt.py            # discretionary real-Git QA; never CI/pre-commit
python3 docs/qa/wt-tab.py        # live Rex QA: rename current tab, then restore it
```
