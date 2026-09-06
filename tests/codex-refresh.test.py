"""Deterministic unit tests; subprocesses and file snapshots are faked."""
import runpy
import unittest
from pathlib import Path

script = runpy.run_path(str(Path(__file__).parents[1] / 'dot_local/bin/executable_refresh-codex'))


class RefreshTest(unittest.TestCase):
    @unittest.expectedFailure
    def test_historical_changes_without_pending_changes_return_no_targets(self):
        self.assertEqual(script['pending_targets']('M  .agents/AGENTS.md\n'), [])

    @unittest.expectedFailure
    def test_pending_changes_preserve_paths_with_spaces(self):
        self.assertEqual(script['pending_targets'](' M .agents/a b\n A .codex/AGENTS.md\n'),
                         ['.agents/a b', '.codex/AGENTS.md'])

    @unittest.expectedFailure
    def test_only_installed_local_marketplace_plugins_are_selected(self):
        local = {'pluginId': 'coding@local-agents', 'marketplaceName': 'local-agents',
                 'installed': True, 'enabled': True}
        remote = dict(local, marketplaceName='other')
        absent = dict(local, installed=False)
        self.assertEqual(script['local_plugins']([local, remote, absent]), [local])

    @unittest.expectedFailure
    def test_changed_missing_and_extra_cache_files_are_reported(self):
        self.assertEqual(script['differences']({'a': b'new', 'b': b'b'},
                                               {'a': b'old', 'c': b'c'}), ['a', 'b', 'c'])

    @unittest.expectedFailure
    def test_identical_snapshots_return_no_differences(self):
        self.assertEqual(script['differences']({'a': b'a'}, {'a': b'a'}), [])

    @unittest.expectedFailure
    def test_refresh_applies_only_targets_then_reinstalls_then_restarts(self):
        calls = []
        script['refresh'](calls.append, ['/home/a/.agents', '/home/a/.codex/AGENTS.md'],
                          [{'pluginId': 'coding@local-agents', 'enabled': True}])
        self.assertEqual(calls, [
            ['chezmoi', 'apply', '--force', '--exclude', 'scripts', '--refresh-externals',
             'always', '/home/a/.agents', '/home/a/.codex/AGENTS.md'],
            ['codex', 'plugin', 'remove', 'coding@local-agents'],
            ['codex', 'plugin', 'add', 'coding@local-agents'],
            ['codex', 'app-server', 'daemon', 'restart']])

    @unittest.expectedFailure
    def test_no_restart_omits_daemon_command(self):
        calls = []
        script['refresh'](calls.append, ['target'], [], restart=False)
        self.assertEqual(len(calls), 1)

    @unittest.expectedFailure
    def test_disabled_plugin_aborts_before_mutation(self):
        calls = []
        with self.assertRaisesRegex(ValueError, 'disabled'):
            script['refresh'](calls.append, ['target'], [{'enabled': False}])
        self.assertEqual(calls, [])

    @unittest.expectedFailure
    def test_apply_failure_prevents_plugin_removal_and_restart(self):
        calls = []
        def fail(command):
            calls.append(command)
            raise RuntimeError('apply failed')
        with self.assertRaisesRegex(RuntimeError, 'apply failed'):
            script['refresh'](fail, ['target'], [])
        self.assertEqual(len(calls), 1)


if __name__ == '__main__':
    unittest.main()
