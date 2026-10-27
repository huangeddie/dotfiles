"""Unit tests: Git, filesystem, and temporary names are replaced by a stateful fake."""
import json
import runpy
import unittest
from pathlib import Path

script = runpy.run_path(str(Path(__file__).parents[1] / "dot_local/bin/executable_wt"))
Worktrees, Checkout = script["Worktrees"], script["Checkout"]


class Repository:
    def __init__(self):
        self.current = "trunk"
        self.branches = {"trunk", "release"}
        self.checkouts = [Checkout("/project", "trunk")]
        self.metadata = {}
        self.dirty_paths = set()
        self.busy_paths = set()
        self.missing_paths = set()
        self.unsafe_paths = set()
        self.submodule_paths = set()
        self.delete_failure = None
        self.ancestors = set()
        self.events = []
        self.merge_fails = False

    def current_branch(self):
        return self.current

    def has_branch(self, branch):
        return branch in self.branches

    def valid_branch(self, branch):
        return bool(branch) and not branch.startswith("-") and ".." not in branch

    def worktrees(self):
        return self.checkouts

    def is_directory(self, path):
        return path not in self.missing_paths

    def validate_sandbox(self, path):
        if path in self.missing_paths or path in self.unsafe_paths:
            raise ValueError("Sandbox path is missing or redirected")

    def records(self):
        return self.metadata

    def dirty(self, path):
        return path in self.dirty_paths

    def busy(self, path):
        return path in self.busy_paths

    def has_initialized_submodules(self, path):
        return path in self.submodule_paths

    def is_ancestor(self, branch, base):
        return (branch, base) in self.ancestors

    def create(self, branch, base, name=None):
        path = "/tmp/wt-fixed/repo"
        self.branches.add(branch)
        self.checkouts.append(Checkout(path, branch))
        self.metadata[branch] = {"base": base, "path": path}
        if name is not None:
            self.metadata[branch]["name"] = name
        self.events.append(("create", branch, base))
        return path

    def merge(self, path, branch):
        self.events.append(("merge", path, branch))
        if self.merge_fails:
            raise RuntimeError("conflict")
        base = next(c.branch for c in self.checkouts if c.path == path)
        self.ancestors.add((branch, base))

    def delete(self, branch, path, force):
        if branch == self.delete_failure:
            raise RuntimeError("removal failed")
        self.events.append(("delete", branch, path, force))
        self.checkouts = [c for c in self.checkouts if c.path != path]
        self.branches.remove(branch)
        del self.metadata[branch]


class LifecycleTest(unittest.TestCase):
    def setUp(self):
        self.repo = Repository()
        self.wt = Worktrees(self.repo)

    def sandbox(self):
        self.repo.create("topic", "trunk")
        self.repo.current = "topic"
        self.repo.events.clear()
        return "/tmp/wt-fixed/repo"

    def test_new_uses_current_branch_instead_of_main_or_master(self):
        self.assertEqual(self.wt.new("feature/a"), "/tmp/wt-fixed/repo")
        self.assertEqual(self.repo.metadata["feature/a"]["base"], "trunk")

    def test_new_normalizes_branch_but_preserves_display_name(self):
        for name, branch in (("Foo Bar", "foo-bar"), ("  Foo \t Bar  ", "foo-bar"),
                             ("Feature/API", "feature/api"), ("FOO-BAR", "foo-bar")):
            with self.subTest(name=name):
                repo = Repository()
                self.assertEqual(Worktrees(repo).new(name), "/tmp/wt-fixed/repo")
                self.assertIn(branch, repo.branches)
                self.assertEqual(repo.metadata[branch], {
                    "base": "trunk", "path": "/tmp/wt-fixed/repo", "name": name})

    def test_normalized_name_collision_rejects_before_creation(self):
        self.repo.branches.add("foo-bar")
        with self.assertRaisesRegex(ValueError, "new branch"):
            self.wt.new("Foo Bar")
        self.assertEqual(self.repo.events, [])

    def test_whitespace_only_name_rejects_before_creation(self):
        with self.assertRaises(ValueError):
            self.wt.new(" \t ")
        self.assertEqual(self.repo.events, [])

    def test_flat_sandbox_removal_preserves_original_checkout(self):
        self.sandbox()
        self.repo.metadata["topic"]["path"] = "/cache/wt/wt-flat"
        self.repo.checkouts[1].path = "/cache/wt/wt-flat"
        self.wt.remove(force=True)
        self.assertEqual(self.repo.events, [("delete", "topic", "/cache/wt/wt-flat", True)])
        self.assertEqual(self.repo.checkouts, [Checkout("/project", "trunk")])

    def test_shared_cache_and_non_sandbox_paths_cannot_be_removed(self):
        self.sandbox()
        for path in ("/cache/wt", "/cache/wt/unrelated", "/cache/wt/wt-flat/../wt-other"):
            self.repo.metadata["topic"]["path"] = path
            self.repo.checkouts[1].path = path
            with self.subTest(path=path), self.assertRaises(ValueError):
                self.wt.remove(force=True)
        self.assertEqual(self.repo.events, [])

    def test_named_metadata_remains_removable(self):
        self.sandbox()
        self.repo.metadata["topic"]["name"] = "Topic"
        self.wt.remove(force=True)
        self.assertNotIn("topic", self.repo.branches)

    def test_invalid_name_metadata_never_permits_force_deletion(self):
        self.sandbox()
        for name in (None, 42, ""):
            self.repo.metadata["topic"]["name"] = name
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.wt.remove(force=True)
        self.assertEqual(self.repo.events, [])

    def test_explicit_base_overrides_current_branch(self):
        self.wt.new("topic", "release")
        self.assertEqual(self.repo.metadata["topic"]["base"], "release")

    def test_detached_head_requires_explicit_base(self):
        self.repo.current = ""
        with self.assertRaisesRegex(ValueError, "base"):
            self.wt.new("topic")
        self.assertEqual(self.repo.events, [])
        self.wt.new("topic", "release")
        self.assertIn("topic", self.repo.branches)

    def test_invalid_existing_or_missing_base_rejects_before_creation(self):
        for branch, base in [("-bad", None), ("trunk", None), ("topic", "missing")]:
            with self.subTest(branch=branch, base=base), self.assertRaises(ValueError):
                self.wt.new(branch, base)
        self.assertEqual(self.repo.events, [])

    def test_merge_uses_recorded_base_and_then_deletes_sandbox(self):
        self.sandbox()
        self.assertEqual(self.wt.merge(), "/project")
        self.assertEqual(self.repo.events, [
            ("merge", "/project", "topic"),
            ("delete", "topic", "/tmp/wt-fixed/repo", False)])
        self.assertNotIn("topic", self.repo.metadata)

    def test_explicit_branch_merges_from_another_checkout(self):
        self.sandbox()
        self.repo.current = "trunk"
        self.wt.merge("topic")
        self.assertNotIn("topic", self.repo.branches)

    def test_conflict_preserves_branch_and_worktree(self):
        self.sandbox()
        self.repo.merge_fails = True
        with self.assertRaisesRegex(RuntimeError, "conflict"):
            self.wt.merge()
        self.assertIn("topic", self.repo.branches)
        self.assertEqual(len(self.repo.checkouts), 2)

    def test_dirty_source_or_base_blocks_merge_before_mutation(self):
        source = self.sandbox()
        for path in (source, "/project"):
            self.repo.dirty_paths = {path}
            with self.subTest(path=path), self.assertRaisesRegex(ValueError, "clean"):
                self.wt.merge()
        self.assertEqual(self.repo.events, [])

    def test_in_progress_operation_blocks_merge(self):
        source = self.sandbox()
        for path in (source, "/project"):
            self.repo.busy_paths = {path}
            with self.subTest(path=path), self.assertRaises(ValueError):
                self.wt.merge()
        self.assertEqual(self.repo.events, [])

    def test_base_not_checked_out_blocks_merge(self):
        self.sandbox()
        self.repo.checkouts[0].branch = "release"
        with self.assertRaisesRegex(ValueError, "checked out"):
            self.wt.merge()
        self.assertEqual(self.repo.events, [])

    def test_unmerged_branch_blocks_normal_removal(self):
        self.sandbox()
        with self.assertRaisesRegex(ValueError, "merged"):
            self.wt.remove()
        self.assertEqual(self.repo.events, [])

    def test_merged_clean_branch_is_removed(self):
        self.sandbox()
        self.repo.ancestors.add(("topic", "trunk"))
        self.wt.remove()
        self.assertNotIn("topic", self.repo.branches)

    def test_dirty_merged_branch_blocks_removal(self):
        path = self.sandbox()
        self.repo.ancestors.add(("topic", "trunk"))
        self.repo.dirty_paths.add(path)
        with self.assertRaisesRegex(ValueError, "clean"):
            self.wt.remove()
        self.assertEqual(self.repo.events, [])

    def test_force_discards_unmerged_dirty_branch(self):
        path = self.sandbox()
        self.repo.dirty_paths.add(path)
        self.wt.remove(force=True)
        self.assertEqual(self.repo.events, [("delete", "topic", path, True)])

    def test_unmanaged_checkout_cannot_be_deleted_even_with_force(self):
        with self.assertRaisesRegex(ValueError, "managed"):
            self.wt.remove(force=True)
        self.assertEqual(self.repo.events, [])

    def test_original_checkout_cannot_be_deleted_even_with_forged_metadata(self):
        self.repo.metadata["trunk"] = {"base": "release", "path": "/project"}
        with self.assertRaises(ValueError):
            self.wt.remove(force=True)
        self.assertEqual(self.repo.events, [])

    def test_mismatched_path_locked_or_prunable_checkout_blocks_force(self):
        for condition in ("path", "locked", "prunable"):
            self.setUp()
            self.sandbox()
            if condition == "path":
                self.repo.metadata["topic"]["path"] = "/tmp/elsewhere"
            else:
                setattr(self.repo.checkouts[1], condition, True)
            with self.subTest(condition=condition), self.assertRaises(ValueError):
                self.wt.remove(force=True)
            self.assertEqual(self.repo.events, [])

    def test_branch_used_as_a_base_cannot_be_deleted_or_merged(self):
        self.sandbox()
        self.repo.metadata["child"] = {"base": "topic", "path": "/tmp/wt-child/repo"}
        for action in (lambda: self.wt.remove(force=True), self.wt.merge):
            with self.assertRaisesRegex(ValueError, "base"):
                action()
        self.assertEqual(self.repo.events, [])

    def test_missing_base_blocks_normal_removal_but_allows_force(self):
        self.sandbox()
        self.repo.branches.remove("trunk")
        with self.assertRaisesRegex(ValueError, "base"):
            self.wt.remove()
        self.wt.remove(force=True)
        self.assertNotIn("topic", self.repo.branches)

    def test_corrupt_metadata_never_permits_force_deletion(self):
        self.sandbox()
        for record in ({}, {"base": "topic", "path": "/tmp/wt-fixed/repo"}, "bad"):
            self.repo.metadata["topic"] = record
            with self.subTest(record=record), self.assertRaises(ValueError):
                self.wt.remove(force=True)
        self.assertEqual(self.repo.events, [])


class ClearTest(unittest.TestCase):
    def setUp(self):
        self.repo = Repository()
        self.wt = Worktrees(self.repo)

    def add(self, branch, base="trunk", merged=True):
        path = f"/cache/wt-{branch}/repo"
        self.repo.branches.add(branch)
        self.repo.checkouts.append(Checkout(path, branch))
        self.repo.metadata[branch] = {"base": base, "path": path}
        if merged:
            self.repo.ancestors.add((branch, base))
        return path

    def test_clear_removes_managed_checkouts_but_preserves_original_and_unmanaged(self):
        self.add("one")
        self.add("two")
        self.repo.branches.add("manual")
        self.repo.checkouts.append(Checkout("/manual", "manual"))
        self.assertEqual(self.wt.clear(), 2)
        self.assertEqual(self.repo.branches, {"trunk", "release", "manual"})
        self.assertEqual(self.repo.checkouts, [Checkout("/project", "trunk"), Checkout("/manual", "manual")])
        self.assertEqual(self.repo.metadata, {})

    def test_clear_without_sandboxes_is_a_noop(self):
        self.assertEqual(self.wt.clear(), 0)
        self.assertEqual(self.repo.events, [])

    def test_clear_checks_every_branch_before_deleting_anything(self):
        self.add("a-clean")
        self.add("z-unmerged", merged=False)
        with self.assertRaisesRegex(ValueError, "not merged"):
            self.wt.clear()
        self.assertEqual(self.repo.events, [])

    def test_clear_checks_every_dirty_or_busy_worktree_before_deleting_anything(self):
        self.add("a-clean")
        path = self.add("z-dirty")
        for paths in (self.repo.dirty_paths, self.repo.busy_paths):
            paths.add(path)
            with self.assertRaisesRegex(ValueError, "clean"):
                self.wt.clear()
            self.assertEqual(self.repo.events, [])
            paths.clear()

    def test_force_clear_discards_unmerged_dirty_worktrees(self):
        path = self.add("dirty", merged=False)
        self.repo.dirty_paths.add(path)
        self.assertEqual(self.wt.clear(force=True), 1)
        self.assertEqual(self.repo.events, [("delete", "dirty", path, True)])

    def test_clear_removes_children_before_their_parents(self):
        self.add("a-parent")
        self.add("b-child", "a-parent")
        self.add("c-grandchild", "b-child")
        self.assertEqual(self.wt.clear(), 3)
        self.assertEqual([event[1] for event in self.repo.events], ["c-grandchild", "b-child", "a-parent"])

    def test_force_clear_rejects_cycles_before_deleting_anything(self):
        self.add("a", "b")
        self.add("b", "a")
        with self.assertRaisesRegex(ValueError, "cycle|cyclic"):
            self.wt.clear(force=True)
        self.assertEqual(self.repo.events, [])

    def test_force_clear_rejects_original_checkout_and_corrupt_records(self):
        self.add("a-clean")
        for record in ({"base": "release", "path": "/project"}, {}, "broken"):
            self.repo.metadata["trunk"] = record
            with self.subTest(record=record), self.assertRaises(ValueError):
                self.wt.clear(force=True)
            self.assertEqual(self.repo.events, [])

    def test_force_clear_checks_locked_prunable_and_mismatched_worktrees_before_deleting(self):
        self.add("a-clean")
        self.add("z-protected")
        target = self.repo.checkouts[-1]
        for field in ("locked", "prunable"):
            setattr(target, field, True)
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.wt.clear(force=True)
            self.assertEqual(self.repo.events, [])
            setattr(target, field, False)
        self.repo.metadata["z-protected"]["path"] = "/unrelated"
        with self.assertRaises(ValueError):
            self.wt.clear(force=True)
        self.assertEqual(self.repo.events, [])

    def test_clear_checks_physical_path_safety_before_deleting_anything(self):
        self.add("a-clean")
        path = self.add("z-unsafe")
        self.repo.unsafe_paths.add(path)
        with self.assertRaisesRegex(ValueError, "redirected"):
            self.wt.clear(force=True)
        self.assertEqual(self.repo.events, [])

    def test_force_clear_allows_missing_base_but_normal_clear_refuses(self):
        self.add("topic", "deleted-base", merged=False)
        with self.assertRaisesRegex(ValueError, "base"):
            self.wt.clear()
        self.assertEqual(self.repo.events, [])
        self.assertEqual(self.wt.clear(force=True), 1)

    def test_clear_preflights_initialized_submodules_but_force_can_discard_them(self):
        self.add("a-clean")
        path = self.add("z-submodule")
        self.repo.submodule_paths.add(path)
        with self.assertRaisesRegex(ValueError, "submodules"):
            self.wt.clear()
        self.assertEqual(self.repo.events, [])
        self.assertEqual(self.wt.clear(force=True), 2)

    def test_clear_stops_at_runtime_failure_and_preserves_remaining_worktrees(self):
        self.add("a")
        self.add("b")
        self.add("c")
        self.repo.delete_failure = "b"
        with self.assertRaisesRegex(RuntimeError, "removal failed"):
            self.wt.clear()
        self.assertEqual(set(self.repo.metadata), {"b", "c"})
        self.assertEqual([event[1] for event in self.repo.events], ["a"])


class SandboxRootTest(unittest.TestCase):
    def test_default_root_is_stable_beneath_home_cache(self):
        self.assertEqual(script["sandbox_root"](Path("/home/user"), {}), Path("/home/user/.cache/wt"))

    def test_absolute_xdg_cache_home_overrides_default_root(self):
        self.assertEqual(script["sandbox_root"](Path("/home/user"), {"XDG_CACHE_HOME": "/private cache"}),
                         Path("/private cache/wt"))

    def test_relative_or_empty_xdg_cache_home_uses_default_root(self):
        for value in ("relative", ""):
            with self.subTest(value=value):
                self.assertEqual(script["sandbox_root"](Path("/home/user"), {"XDG_CACHE_HOME": value}),
                                 Path("/home/user/.cache/wt"))


class NavigationTest(unittest.TestCase):
    def setUp(self):
        self.repo = Repository()
        self.repo.branches.add("feature/a")
        self.repo.checkouts.extend([
            Checkout("/manual worktree", "feature/a"),
            Checkout("/detached checkout")])
        self.wt = Worktrees(self.repo)

    def test_list_includes_original_unmanaged_and_detached_checkouts(self):
        self.assertEqual(self.wt.list(),
                         "trunk\t/project\nfeature/a\t/manual worktree\n(detached)\t/detached checkout")
        self.assertEqual(self.repo.events, [])

    def test_cd_resolves_original_and_unmanaged_checkout_paths(self):
        self.assertEqual(self.wt.path("trunk"), "/project")
        self.assertEqual(self.wt.path("feature/a"), "/manual worktree")
        self.assertEqual(self.repo.events, [])

    def test_navigation_allows_dirty_and_locked_worktrees(self):
        self.repo.checkouts[1].locked = True
        self.repo.dirty_paths.add("/manual worktree")
        self.assertEqual(self.wt.path("feature/a"), "/manual worktree")

    def test_existing_branch_without_worktree_has_readable_error(self):
        with self.assertRaisesRegex(ValueError, "release.*not checked out"):
            self.wt.path("release")
        self.assertEqual(self.repo.events, [])

    def test_unknown_branch_has_readable_error(self):
        with self.assertRaisesRegex(ValueError, "No local branch.*unknown"):
            self.wt.path("unknown")

    def test_branch_matching_is_exact_without_guessing(self):
        with self.assertRaisesRegex(ValueError, "No local branch.*feature"):
            self.wt.path("feature")

    def test_duplicate_checkouts_for_one_branch_are_rejected(self):
        self.repo.checkouts.append(Checkout("/duplicate", "feature/a"))
        with self.assertRaisesRegex(ValueError, "multiple worktrees"):
            self.wt.path("feature/a")

    def test_prunable_or_missing_worktree_has_readable_error(self):
        self.repo.checkouts[1].prunable = True
        with self.assertRaisesRegex(ValueError, "missing.*manual worktree"):
            self.wt.path("feature/a")
        self.repo.checkouts[1].prunable = False
        self.repo.missing_paths.add("/manual worktree")
        with self.assertRaisesRegex(ValueError, "missing.*manual worktree"):
            self.wt.path("feature/a")

    def test_empty_branch_cannot_select_detached_checkout(self):
        with self.assertRaisesRegex(ValueError, "branch"):
            self.wt.path("")


class TabTitleTest(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.rex = {"REX_SESSION": "session:ours", "REX_BLOCK": "block:ours"}
        self.herdr = {"HERDR_ENV": "1", "HERDR_PANE_ID": "w1:p1", "HERDR_TAB_ID": "w1:t1"}
        self.rex_response = {"session_id": "session:ours", "block": {
            "block_id": "block:ours", "window_id": "window:ours"}}
        self.herdr_response = {"id": "request", "result": {"type": "pane_current", "pane": {
            "pane_id": "w2:p2", "terminal_id": "terminal", "workspace_id": "w2",
            "tab_id": "w2:t3", "focused": False, "agent_status": "idle", "revision": 1}}}

    def execute(self, command):
        self.calls.append(command)
        if "inspect" in command:
            return json.dumps(self.rex_response)
        if "current" in command:
            return json.dumps(self.herdr_response)
        return ""

    def rename(self, environment):
        script["rename_tab"]("feature/a", environment, self.execute)

    def test_saved_display_name_is_passed_intact_to_each_multiplexer(self):
        repo = Repository()
        repo.create("foo-bar", "trunk", "Foo Bar")
        repo.current = "foo-bar"
        for environment in (self.rex, self.herdr):
            with self.subTest(environment=environment):
                self.calls.clear()
                script["rename_tab"](Worktrees(repo).title(), environment, self.execute)
                self.assertTrue(self.calls)
                self.assertEqual(self.calls[-1][-1], "Foo Bar")

    def test_legacy_unmanaged_and_detached_checkouts_fall_back_to_branch(self):
        repo = Repository()
        repo.create("legacy", "trunk")
        for branch in ("legacy", "trunk", ""):
            repo.current = branch
            with self.subTest(branch=branch):
                self.assertEqual(Worktrees(repo).title(), branch)

    def test_unusable_display_name_falls_back_to_branch(self):
        repo = Repository()
        for record in (None, "bad", {"name": None}, {"name": 42}, {"name": ""}):
            repo.metadata["trunk"] = record
            with self.subTest(record=record):
                self.assertEqual(Worktrees(repo).title(), "trunk")

    def test_no_multiplexer_environment_does_not_run_commands(self):
        self.rename({})
        self.assertEqual(self.calls, [])

    def test_rex_renames_callers_window_without_using_focus(self):
        self.rename(self.rex)
        self.assertEqual(self.calls, [
            ["rex", "--autostart=false", "--timeout", "2s", "block", "inspect",
             "-s", "session:ours", "block:ours", "--json"],
            ["rex", "--autostart=false", "--timeout", "2s", "window", "rename",
             "-s", "session:ours", "--", "window:ours", "feature/a"]])

    def test_herdr_resolves_current_tab_instead_of_stale_inherited_tab_id(self):
        self.rename(self.herdr)
        self.assertEqual(self.calls, [
            ["herdr", "pane", "current", "--current"],
            ["herdr", "tab", "rename", "--", "w2:t3", "feature/a"]])

    def test_nested_herdr_takes_precedence_over_outer_rex(self):
        self.rename(dict(self.rex, **self.herdr))
        self.assertEqual([command[0] for command in self.calls], ["herdr", "herdr"])

    def test_incomplete_context_does_not_guess_a_focused_target(self):
        for environment in ({"REX_SESSION": "session:ours"}, {"REX_BLOCK": "block:ours"},
                            {"HERDR_ENV": "1"}, dict(self.rex, HERDR_ENV="1")):
            with self.subTest(environment=environment):
                self.rename(environment)
                self.assertEqual(self.calls, [])

    def test_malformed_response_cannot_rename_a_tab(self):
        for response in ({}, {"block": {"window_id": ""}}, {"block": {"window_id": 4}}):
            self.rex_response = response
            with self.subTest(response=response), self.assertRaises(ValueError):
                self.rename(self.rex)
            self.assertFalse(any("rename" in call for call in self.calls))

    def test_rex_response_for_another_caller_cannot_rename_its_tab(self):
        self.rex_response["block"]["block_id"] = "block:someone-else"
        with self.assertRaises(ValueError):
            self.rename(self.rex)
        self.assertEqual(len(self.calls), 1)


class ParsingTest(unittest.TestCase):
    def test_nul_delimited_paths_preserve_spaces_and_newlines(self):
        output = ("worktree /my project\0HEAD abc\0branch refs/heads/trunk\0\0"
                  "worktree /tmp/a\nb\0HEAD def\0branch refs/heads/feature/a\0"
                  "locked reason\0\0worktree /gone\0HEAD ghi\0detached\0prunable missing\0\0")
        result = script["parse_worktrees"](output)
        self.assertEqual(result, [
            Checkout("/my project", "trunk"),
            Checkout("/tmp/a\nb", "feature/a", locked=True),
            Checkout("/gone", prunable=True)])


if __name__ == "__main__":
    unittest.main()
