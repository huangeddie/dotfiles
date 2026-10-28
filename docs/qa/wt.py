#!/usr/bin/env python3
"""Discretionary real-Git QA. Run manually; never include in CI/unit test discovery."""
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile

CLI = Path(__file__).resolve().parents[2] / "dot_local/bin/executable_wt"
ALIASES = Path(__file__).resolve().parents[2] / "dot_bash_aliases"
ENV = {k: v for k, v in os.environ.items() if not k.startswith(("GIT_", "REX_", "HERDR_"))}
ENV.update(GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull,
           GIT_TERMINAL_PROMPT="0", GIT_EDITOR=":", GIT_MERGE_AUTOEDIT="no",
           GIT_AUTHOR_DATE="2026-01-01T00:00:00Z", GIT_COMMITTER_DATE="2026-01-01T00:00:00Z")


def run(cwd, *args, ok=True):
    result = subprocess.run(args, cwd=cwd, env=ENV, text=True, capture_output=True)
    assert (result.returncode == 0) == ok, (args, result.returncode, result.stdout, result.stderr)
    return result.stdout.strip()


def git(cwd, *args, **kwargs):
    return run(cwd, "git", *args, **kwargs)


def wt(cwd, *args, **kwargs):
    return run(cwd, sys.executable, str(CLI), *args, **kwargs)


def commit(repo, filename, text):
    (repo / filename).write_text(text)
    git(repo, "add", filename)
    git(repo, "commit", "-qm", "test: update fixture")


def setup(root, name):
    repo = root / name
    repo.mkdir()
    git(repo, "init", "-q", "-b", "trunk")
    git(repo, "config", "user.name", "WT QA")
    git(repo, "config", "user.email", "wt-qa@example.invalid")
    commit(repo, "shared.txt", "initial\n")
    return repo


def verify_display_names_and_normalized_branches(root):
    repo = setup(root, "display-names")
    path = Path(wt(repo, "new", "Foo Bar"))
    assert git(path, "symbolic-ref", "--short", "HEAD") == "foo-bar"
    record = json.loads(git(repo, "config", "--local", "--get", "branch.foo-bar.wt"))
    assert record == {"base": "trunk", "path": str(path), "name": "Foo Bar"}
    assert wt(repo, "cd", "foo-bar") == str(path)
    wt(repo, "new", "FOO BAR", ok=False)
    for name in ("   ", "Bad..Name", "Bad~Name", "Bad:Name"):
        wt(repo, "new", name, ok=False)
    wt(repo, "merge", "foo-bar")
    assert not path.exists() and path.parent.is_dir()
    git(repo, "config", "--local", "--get", "branch.foo-bar.wt", ok=False)


def verify_stable_private_cache_root(root):
    repo = setup(root, "stable-root")
    cache = Path(ENV["XDG_CACHE_HOME"]) / "wt"
    first = Path(wt(repo, "new", "first"))
    assert first.parent == cache and first.name.startswith("wt-"), first
    assert cache.stat().st_mode & 0o777 == 0o700
    wt(repo, "remove", "first")
    assert cache.is_dir() and not first.exists()
    second = Path(wt(repo, "new", "second"))
    assert second.parent == cache and first != second
    wt(repo, "remove", "second")
    cache.chmod(0o755)
    try:
        wt(repo, "new", "unsafe", ok=False)
        git(repo, "show-ref", "--verify", "refs/heads/unsafe", ok=False)
    finally:
        cache.chmod(0o700)
    saved = cache.with_name("saved-wt")
    cache.rename(saved)
    cache.symlink_to(saved, target_is_directory=True)
    try:
        wt(repo, "new", "redirected", ok=False)
        git(repo, "show-ref", "--verify", "refs/heads/redirected", ok=False)
    finally:
        cache.unlink()
        saved.rename(cache)


def verify_clear_preflight_and_repository_scope(root):
    repo = setup(root, "clear")
    other = setup(root, "other-repository")
    first = Path(wt(repo, "new", "a-clean"))
    last = Path(wt(repo, "new", "z-unmerged"))
    commit(last, "new.txt", "unmerged\n")
    (last / "untracked").write_text("uncommitted\n")
    wt(other, "new", "a-clean", ok=False)
    assert first.is_dir()
    git(other, "show-ref", "--verify", "refs/heads/a-clean", ok=False)
    untouched = Path(wt(other, "new", "other-clean"))
    manual = root / "unmanaged-clear"
    git(repo, "worktree", "add", "-qb", "manual", str(manual))
    git(repo, "branch", "unoccupied")
    # Legacy sandboxes remain manageable even outside the new cache root.
    legacy = Path(tempfile.mkdtemp(prefix="wt-", dir=ENV["TMPDIR"])) / "repo"
    git(repo, "worktree", "add", "-qb", "legacy", str(legacy))
    git(repo, "config", "--local", "branch.legacy.wt", json.dumps({"base": "trunk", "path": str(legacy)}))
    wt(repo, "clear", ok=False)
    assert all(p.is_dir() for p in (first, last, legacy, untouched, manual))
    git(repo, "worktree", "lock", str(last))
    wt(repo, "clear", "--force", ok=False)
    assert first.is_dir() and legacy.is_dir()
    git(repo, "worktree", "unlock", str(last))
    wt(repo, "clear", "--force")
    assert not first.exists() and not last.exists() and not legacy.parent.exists()
    assert untouched.is_dir() and manual.is_dir() and repo.is_dir()
    assert set(git(repo, "branch", "--format=%(refname:short)").splitlines()) == {"trunk", "manual", "unoccupied"}
    git(repo, "config", "--local", "--get-regexp", r"^branch\..*\.wt$", ok=False)
    wt(repo, "clear")  # Empty clear is a successful no-op.
    wt(other, "clear")
    assert not untouched.exists() and untouched.parent.is_dir()


def verify_clear_preflights_initialized_submodules(root):
    repo = setup(root, "submodule-clear")
    module = setup(root, "submodule-source")
    first = Path(wt(repo, "new", "a-clean"))
    git(repo, "-c", "protocol.file.allow=always", "submodule", "add", "-q", str(module), "module")
    git(repo, "commit", "-qm", "test: add submodule")
    last = Path(wt(repo, "new", "z-submodule"))
    git(last, "-c", "protocol.file.allow=always", "submodule", "update", "--init", "-q")
    wt(repo, "clear", ok=False)
    assert first.is_dir() and last.is_dir(), "Submodules must be detected before any deletion"
    wt(repo, "clear", "--force")
    assert not first.exists() and not last.exists()


def verify_nested_clear_from_a_sandbox(root):
    repo = setup(root, "nested-clear")
    parent = Path(wt(repo, "new", "parent"))
    child = Path(wt(parent, "new", "child"))
    commit(child, "nested.txt", "merged\n")
    git(parent, "merge", "--no-ff", "--no-edit", "child")
    git(repo, "merge", "--no-ff", "--no-edit", "parent")
    wt(child, "clear")
    assert not child.exists() and not parent.exists()
    assert (repo / "nested.txt").read_text() == "merged\n"
    assert git(repo, "branch", "--format=%(refname:short)") == "trunk"


def verify_merge_commit_and_cleanup(root):
    repo = setup(root, "merge with spaces")
    path = Path(wt(repo, "new", "feature/slash"))
    assert path == Path(ENV["XDG_CACHE_HOME"]) / "wt" / "wt-feature-slash" and path.is_dir(), path
    wt(repo, "new", "feature-slash", ok=False)
    git(repo, "show-ref", "--verify", "refs/heads/feature-slash", ok=False)
    initial = git(repo, "rev-parse", "HEAD")
    assert git(path, "rev-parse", "HEAD") == initial
    commit(path, "feature.txt", "feature\n")
    tip = git(path, "rev-parse", "HEAD")
    wt(path, "remove", ok=False)
    # Run from inside the sandbox to exercise deleting the process's cwd.
    wt(path, "merge")
    assert git(repo, "show", "-s", "--format=%P", "HEAD").split() == [initial, tip]
    assert not path.exists()
    git(repo, "show-ref", "--verify", "refs/heads/feature/slash", ok=False)
    git(repo, "config", "--get", "branch.feature/slash.wt", ok=False)


def verify_bases_detached_and_nested(root):
    repo = setup(root, "bases")
    git(repo, "branch", "release")
    commit(repo, "trunk.txt", "trunk\n")
    git(repo, "switch", "--detach", "-q")
    wt(repo, "new", "rejected", ok=False)
    path = Path(wt(repo, "new", "parent", "--base", "release"))
    assert git(path, "rev-parse", "HEAD") == git(repo, "rev-parse", "release")
    git(repo, "switch", "-q", "trunk")
    wt(repo, "merge", "parent", ok=False)  # release isn't checked out
    child = Path(wt(path, "new", "child"))
    wt(repo, "remove", "parent", "--force", ok=False)
    commit(child, "child.txt", "nested\n")
    wt(path, "merge", "child")
    assert (path / "child.txt").exists() and not child.exists()
    wt(repo, "remove", "parent", "--force")
    assert not path.exists()


def verify_force_and_dirty_protection(root):
    repo = setup(root, "force")
    path = Path(wt(repo, "new", "topic"))
    (path / "untracked").write_text("do not lose\n")
    wt(repo, "remove", "topic", ok=False)
    wt(repo, "merge", "topic", ok=False)
    assert (path / "untracked").exists()
    git(repo, "worktree", "lock", str(path))
    wt(repo, "remove", "topic", "--force", ok=False)
    git(repo, "worktree", "unlock", str(path))
    wt(repo, "remove", "topic", "--force")
    assert not path.exists()
    wt(repo, "remove", "trunk", "--force", ok=False)
    assert repo.exists()


def verify_conflict_recovery(root):
    repo = setup(root, "conflicts")
    path = Path(wt(repo, "new", "topic"))
    commit(path, "shared.txt", "feature\n")
    commit(repo, "shared.txt", "base\n")
    wt(path, "merge", ok=False)
    assert path.exists() and (repo / ".git/MERGE_HEAD").exists()
    # While a merge is in progress, another attempt must not clean anything up.
    wt(path, "merge", ok=False)
    commit(repo, "shared.txt", "resolved\n")
    wt(repo, "remove", "topic")
    assert not path.exists()


def verify_unmanaged_and_dirty_base(root):
    repo = setup(root, "unmanaged")
    unmanaged = root / "manual checkout"
    git(repo, "worktree", "add", "-qb", "manual", str(unmanaged))
    wt(repo, "remove", "manual", "--force", ok=False)
    assert unmanaged.exists()
    path = Path(wt(repo, "new", "topic"))
    (repo / "local.txt").write_text("local\n")
    wt(repo, "merge", "topic", ok=False)
    assert path.exists()
    (repo / "local.txt").unlink()
    wt(repo, "merge", "topic")  # Already merged is a successful no-op plus cleanup.
    assert not path.exists()


def verify_existing_branch_and_ignored_cleanup(root):
    repo = setup(root, "validation")
    wt(repo, "new", "trunk", ok=False)
    wt(repo, "new", "bad..name", ok=False)
    wt(repo, "new", "topic", "--base", "missing", ok=False)
    commit(repo, ".gitignore", "cache/\n")
    path = Path(wt(repo, "new", "topic"))
    (path / "cache").mkdir()
    (path / "cache/build").write_text("disposable\n")
    wt(repo, "remove", "topic")
    assert not path.exists()


def verify_listing_and_existing_checkouts(root):
    repo = setup(root, "listing")
    manual = root / "manual worktree"
    detached = root / "detached worktree"
    git(repo, "worktree", "add", "-qb", "feature/a", str(manual))
    git(repo, "worktree", "add", "-q", "--detach", str(detached))
    git(repo, "branch", "unoccupied")
    assert set(wt(manual, "list").splitlines()) == {
        f"trunk\t{repo}", f"feature/a\t{manual}", f"(detached)\t{detached}"}
    assert wt(manual, "cd", "trunk") == str(repo)
    (manual / "untracked").write_text("keep\n")
    git(repo, "worktree", "lock", str(manual))
    assert wt(repo, "cd", "feature/a") == str(manual)
    for branch, message in (("unoccupied", "not checked out"), ("unknown", "No local branch")):
        result = subprocess.run([sys.executable, str(CLI), "cd", branch],
                                cwd=repo, env=ENV, text=True, capture_output=True)
        assert result.returncode != 0 and not result.stdout
        assert branch in result.stderr and message in result.stderr, result.stderr
    assert len(git(repo, "worktree", "list", "--porcelain").split("worktree ")) == 4
    carriage = root / "carriage\r\n"
    (root / "carriage\n").mkdir()  # Wrong normalized destination also exists.
    git(repo, "worktree", "add", "-qb", "carriage", str(carriage))
    result = subprocess.run([sys.executable, str(CLI), "cd", "carriage"],
                            cwd=repo, env=ENV, capture_output=True, check=True)
    assert result.stdout == os.fsencode(carriage) + b"\n", "CRLF path was normalized"


def verify_shell_navigation(root):
    bin_dir = root / "bin"
    bin_dir.mkdir()
    launcher = bin_dir / "wt"
    launcher.write_text("#!/bin/sh\nexec " + shlex.join([sys.executable, str(CLI)]) + ' "$@"\n')
    launcher.chmod(0o755)
    previous_path = ENV["PATH"]
    ENV["PATH"] = str(bin_dir) + os.pathsep + previous_path
    try:
        for shell in ("bash", "zsh"):
            executable = shutil.which(shell)
            if not executable:
                print(f"SKIP: {shell} is not installed")
                continue
            repo = setup(root, "shell-" + shell)
            run(repo, executable, "-c", '''
set -eu
. "$1"
original=$PWD
wt new "Foo Bar"
[ "$PWD" != "$original" ]
[ "$(git symbolic-ref --short HEAD)" = foo-bar ]
sandbox=$PWD
if wt new "FOO BAR"; then exit 1; fi
[ "$PWD" = "$sandbox" ]
for flag in --help -h --h --he --hel -hh; do
  wt new "$flag" >/dev/null
  [ "$PWD" = "$sandbox" ]
done
wt cd trunk
[ "$PWD" = "$original" ]
wt cd foo-bar
[ "$PWD" = "$sandbox" ]
git branch unoccupied
if wt cd unoccupied; then exit 1; fi
[ "$PWD" = "$sandbox" ]
for flag in --help -h --h --he --hel -hh; do
  wt cd "$flag" >/dev/null
  [ "$PWD" = "$sandbox" ]
done
wt list >/dev/null
[ "$PWD" = "$sandbox" ]
wt cd trunk
wt merge foo-bar
# A manually created checkout can have whitespace, even a trailing newline.
unusual="$original/manual checkout
"
git worktree add -qb manual "$unusual"
wt cd manual
[ "$PWD" = "$unusual" ]
wt cd trunk
git worktree remove "$unusual"
[ ! -d "$sandbox" ]
[ -d "$(dirname "$sandbox")" ]
''', "wt-qa", str(ALIASES))
    finally:
        ENV["PATH"] = previous_path


def main():
    with tempfile.TemporaryDirectory(prefix="wt-qa-") as directory:
        root = Path(directory).resolve()
        sandbox_root = root / "sandboxes"
        sandbox_root.mkdir()
        ENV["TMPDIR"] = str(sandbox_root)
        ENV["XDG_CACHE_HOME"] = str(root / "cache")
        for verify in (verify_display_names_and_normalized_branches,
                       verify_stable_private_cache_root, verify_clear_preflight_and_repository_scope,
                       verify_clear_preflights_initialized_submodules, verify_nested_clear_from_a_sandbox,
                       verify_merge_commit_and_cleanup, verify_bases_detached_and_nested,
                       verify_force_and_dirty_protection, verify_conflict_recovery,
                       verify_unmanaged_and_dirty_base, verify_existing_branch_and_ignored_cleanup,
                       verify_listing_and_existing_checkouts, verify_shell_navigation):
            verify(root)
            print(f"PASS: {verify.__name__}")
        assert list(sandbox_root.iterdir()) == [], "Leftover legacy sandbox directories"
        cache = Path(ENV["XDG_CACHE_HOME"]) / "wt"
        assert cache.is_dir() and list(cache.iterdir()) == [], "Cache root must survive empty"


if __name__ == "__main__":
    main()
