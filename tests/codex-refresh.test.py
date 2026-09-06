"""Deterministic unit tests; subprocesses and file snapshots are faked."""
import runpy
import unittest
from pathlib import Path

script = runpy.run_path(str(Path(__file__).parents[1] / 'dot_local/bin/executable_refresh-codex'))


class RefreshTest(unittest.TestCase):
    def test_historical_changes_without_pending_changes_return_no_targets(self):
        self.assertEqual(script['pending_targets']('M  .agents/AGENTS.md\n'), [])

    def test_pending_changes_preserve_paths_with_spaces(self):
        self.assertEqual(script['pending_targets'](' M .agents/a b\n A .codex/AGENTS.md\n'),
                         ['.agents/a b', '.codex/AGENTS.md'])

    def test_only_installed_local_marketplace_plugins_are_selected(self):
        local = {'pluginId': 'coding@local-agents', 'marketplaceName': 'local-agents',
                 'installed': True, 'enabled': True}
        remote = dict(local, marketplaceName='other')
        absent = dict(local, installed=False)
        self.assertEqual(script['local_plugins']([local, remote, absent]), [local])

    def test_changed_missing_and_extra_cache_files_are_reported(self):
        self.assertEqual(script['differences']({'a': b'new', 'b': b'b'},
                                               {'a': b'old', 'c': b'c'}), ['a', 'b', 'c'])

    def test_identical_snapshots_return_no_differences(self):
        self.assertEqual(script['differences']({'a': b'a'}, {'a': b'a'}), [])

    def test_refresh_applies_only_targets_then_reinstalls_then_restarts(self):
        calls = []
        script['refresh'](calls.append, ['/home/a/.agents', '/home/a/.codex/AGENTS.md'],
                          [{'pluginId': 'coding@local-agents', 'enabled': True}])
        self.assertEqual(calls, [
            ['chezmoi', 'apply', '--force', '--exclude', 'scripts', '--refresh-externals=always', '/home/a/.agents', '/home/a/.codex/AGENTS.md'],
            ['codex', 'plugin', 'remove', 'coding@local-agents'],
            ['codex', 'plugin', 'add', 'coding@local-agents'],
            ['codex', 'app-server', 'daemon', 'restart']])

    def test_no_restart_omits_daemon_command(self):
        calls = []
        script['refresh'](calls.append, ['target'], [], restart=False)
        self.assertEqual(len(calls), 1)

    def test_disabled_plugin_aborts_before_mutation(self):
        calls = []
        with self.assertRaisesRegex(ValueError, 'disabled'):
            script['refresh'](calls.append, ['target'], [{'enabled': False}])
        self.assertEqual(calls, [])

    def test_apply_failure_prevents_plugin_removal_and_restart(self):
        calls = []
        def fail(command):
            calls.append(command)
            raise RuntimeError('apply failed')
        with self.assertRaisesRegex(RuntimeError, 'apply failed'):
            script['refresh'](fail, ['target'], [])
        self.assertEqual(len(calls), 1)



    @unittest.expectedFailure
    def test_missing_packages_include_every_uninstalled_local_selector(self):
        installed = [{'pluginId': 'coding@local-agents'}]
        self.assertEqual(script['missing_plugins'](
            ['superpowers@local-agents', 'coding@local-agents', 'assistant@local-agents'],
            installed), ['assistant@local-agents', 'superpowers@local-agents'])

    @unittest.expectedFailure
    def test_sync_discovers_after_apply_and_installs_missing_packages_before_verification(self):
        calls = []
        def discover():
            self.assertEqual(calls[0][0:2], ['chezmoi', 'apply'])
            return ['assistant@local-agents', 'coding@local-agents', 'devops@local-agents',
                    'superpowers@local-agents']
        script['refresh'](calls.append, ['target'],
                          [{'pluginId': 'coding@local-agents', 'enabled': True}],
                          discover=discover, verify=lambda: calls.append(['verify']))
        self.assertEqual(calls[1:], [
            ['codex', 'plugin', 'remove', 'coding@local-agents'],
            ['codex', 'plugin', 'add', 'coding@local-agents'],
            ['codex', 'plugin', 'add', 'assistant@local-agents'],
            ['codex', 'plugin', 'add', 'devops@local-agents'],
            ['codex', 'plugin', 'add', 'superpowers@local-agents'],
            ['verify'], ['codex', 'app-server', 'daemon', 'restart']])

    @unittest.expectedFailure
    def test_install_failure_reports_recovery_and_prevents_verification_and_restart(self):
        calls = []
        def run(command):
            calls.append(command)
            if command[:3] == ['codex', 'plugin', 'add']:
                raise RuntimeError('install failed')
        with self.assertRaisesRegex(RuntimeError, 'Recover with: codex plugin add assistant@local-agents'):
            script['refresh'](run, ['target'], [],
                              discover=lambda: ['assistant@local-agents'],
                              verify=lambda: calls.append(['verify']))
        self.assertEqual(calls[1:], [['codex', 'plugin', 'add', 'assistant@local-agents']])

    def test_verification_failure_prevents_restart(self):
        calls = []
        def verify():
            raise RuntimeError('verification failed')
        with self.assertRaisesRegex(RuntimeError, 'verification failed'):
            script['refresh'](calls.append, ['target'], [], verify=verify)
        self.assertEqual(len(calls), 1)


if __name__ == '__main__':
    unittest.main()
