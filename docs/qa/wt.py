#!/usr/bin/env python3
"""Discretionary real-Git QA. Run manually; never include in CI/unit test discovery."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile

CLI = Path(__file__).resolve().parents[2] / "dot_local/bin/executable_wt"
ENV = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
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


def verify_merge_commit_and_cleanup(root):
    repo = setup(root, "merge with spaces")
    path = Path(wt(repo, "new", "feature/slash"))
    assert path.is_absolute() and path.is_dir(), path
    initial = git(repo, "rev-parse", "HEAD")
    assert git(path, "rev-parse", "HEAD") == initial
    commit(path, "feature.txt", "feature\n")
    tip = git(path, "rev-parse", "HEAD")
    wt(path, "remove", ok=False)
    # Run from inside the sandbox to exercise deleting the process's cwd.
    wt(path, "merge")
    assert git(repo, "show", "-s", "--format=%P", "HEAD").split() == [initial, tip]
    assert not path.parent.exists()
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
    assert (path / "child.txt").exists() and not child.parent.exists()
    wt(repo, "remove", "parent", "--force")
    assert not path.parent.exists()


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
    assert not path.parent.exists()
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
    assert not path.parent.exists()


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
    assert not path.parent.exists()


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
    assert not path.parent.exists()


def main():
    with tempfile.TemporaryDirectory(prefix="wt-qa-") as directory:
        root = Path(directory).resolve()
        sandbox_root = root / "sandboxes"
        sandbox_root.mkdir()
        ENV["TMPDIR"] = str(sandbox_root)
        for verify in (verify_merge_commit_and_cleanup, verify_bases_detached_and_nested,
                       verify_force_and_dirty_protection, verify_conflict_recovery,
                       verify_unmanaged_and_dirty_base, verify_existing_branch_and_ignored_cleanup):
            verify(root)
            print(f"PASS: {verify.__name__}")
        assert list(sandbox_root.iterdir()) == [], "Leftover sandbox directories"


if __name__ == "__main__":
    main()
