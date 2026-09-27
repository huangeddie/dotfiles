"""Deterministic unit tests; subprocesses and file snapshots are faked."""
import runpy
import unittest
from pathlib import Path

script = runpy.run_path(str(Path(__file__).parents[1] / 'dot_local/bin/executable_sync-codex'))


class SyncTest(unittest.TestCase):
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
        script['sync'](calls.append, ['/home/a/.agents', '/home/a/.codex/AGENTS.md'],
                          [{'pluginId': 'coding@local-agents', 'enabled': True}])
        self.assertEqual(calls, [
            ['chezmoi', 'apply', '--force', '--exclude', 'scripts', '--refresh-externals=always', '/home/a/.agents', '/home/a/.codex/AGENTS.md'],
            ['codex', 'plugin', 'remove', 'coding@local-agents'],
            ['codex', 'plugin', 'add', 'coding@local-agents'],
            ['codex', 'app-server', 'daemon', 'restart']])

    def test_no_restart_omits_daemon_command(self):
        calls = []
        script['sync'](calls.append, ['target'], [], restart=False)
        self.assertEqual(len(calls), 1)

    def test_disabled_plugin_aborts_before_mutation(self):
        calls = []
        with self.assertRaisesRegex(ValueError, 'disabled'):
            script['sync'](calls.append, ['target'], [{'enabled': False}])
        self.assertEqual(calls, [])

    def test_apply_failure_prevents_plugin_removal_and_restart(self):
        calls = []
        def fail(command):
            calls.append(command)
            raise RuntimeError('apply failed')
        with self.assertRaisesRegex(RuntimeError, 'apply failed'):
            script['sync'](fail, ['target'], [])
        self.assertEqual(len(calls), 1)



    def test_missing_packages_include_every_uninstalled_local_selector(self):
        installed = [{'pluginId': 'coding@local-agents'}]
        self.assertEqual(script['missing_plugins'](
            ['superpowers@local-agents', 'coding@local-agents', 'assistant@local-agents'],
            installed), ['assistant@local-agents', 'superpowers@local-agents'])

    def test_sync_discovers_after_apply_and_installs_missing_packages_before_verification(self):
        calls = []
        def discover():
            self.assertEqual(calls[0][0:2], ['chezmoi', 'apply'])
            return ['assistant@local-agents', 'coding@local-agents', 'devops@local-agents',
                    'superpowers@local-agents']
        script['sync'](calls.append, ['target'],
                          [{'pluginId': 'coding@local-agents', 'enabled': True}],
                          discover=discover, verify=lambda: calls.append(['verify']))
        self.assertEqual(calls[1:], [
            ['codex', 'plugin', 'remove', 'coding@local-agents'],
            ['codex', 'plugin', 'add', 'coding@local-agents'],
            ['codex', 'plugin', 'add', 'assistant@local-agents'],
            ['codex', 'plugin', 'add', 'devops@local-agents'],
            ['codex', 'plugin', 'add', 'superpowers@local-agents'],
            ['verify'], ['codex', 'app-server', 'daemon', 'restart']])

    def test_install_failure_reports_recovery_and_prevents_verification_and_restart(self):
        calls = []
        def run(command):
            calls.append(command)
            if command[:3] == ['codex', 'plugin', 'add']:
                raise RuntimeError('install failed')
        with self.assertRaisesRegex(RuntimeError, 'Recover with: codex plugin add assistant@local-agents'):
            script['sync'](run, ['target'], [],
                              discover=lambda: ['assistant@local-agents'],
                              verify=lambda: calls.append(['verify']))
        self.assertEqual(calls[1:], [['codex', 'plugin', 'add', 'assistant@local-agents']])

    def test_verification_failure_prevents_restart(self):
        calls = []
        def verify():
            raise RuntimeError('verification failed')
        with self.assertRaisesRegex(RuntimeError, 'verification failed'):
            script['sync'](calls.append, ['target'], [], verify=verify)
        self.assertEqual(len(calls), 1)


class UpstreamTest(unittest.TestCase):
    def config(self, location='', content=None):
        text = content if content is not None else ('[".agents/packages/superpowers/skills"]\n'
            'url = "https://github.com/huangeddie/superpowers/archive/refs/heads/main.tar.gz"\n')
        def walk(root):
            dirs = ['.git', 'nested']
            yield str(root), dirs, ['.chezmoiexternal.toml'] if not location else []
            if '.git' in dirs:
                yield str(root / '.git'), [], ['.chezmoiexternal.toml']
            if location:
                yield str(root / location), [], ['.chezmoiexternal.toml']
        return script['superpowers_remote'](Path('/source'), walk, lambda path: text)

    @unittest.expectedFailure
    def test_personal_work_and_deep_configs_resolve_upstream(self):
        for location in ['', '_personal', 'some/deeply/nested/directory']:
            with self.subTest(location=location):
                self.assertEqual(self.config(location), ('huangeddie', 'superpowers', 'main'))

    @unittest.expectedFailure
    def test_git_directory_is_pruned_and_missing_config_raises(self):
        def walk(root):
            dirs = ['.git']
            yield str(root), dirs, []
            if '.git' in dirs:
                yield str(root / '.git'), [], ['.chezmoiexternal.toml']
        with self.assertRaisesRegex(ValueError, 'Could not find url'):
            script['superpowers_remote'](Path('/source'), walk, lambda path: 'unused')

    @unittest.expectedFailure
    def test_unrelated_section_does_not_supply_url(self):
        with self.assertRaisesRegex(ValueError, 'Could not find url'):
            self.config(content='["other"]\nurl = "https://example.com"\n')

    @unittest.expectedFailure
    def test_unsupported_url_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Unrecognized archive url'):
            self.config(content='[".agents/packages/superpowers/skills"]\nurl = "https://example.com"\n')

    def check(self, local=None, missing=None, failure=None):
        self.calls = []
        def run(command):
            self.calls.append(command)
            if failure:
                raise RuntimeError('clone failed')
            return '0123456789abcdef\n' if 'rev-parse' in command else ''
        snapshots = {Path('/checkout/skills'): {'skill': 'new'},
                     Path('/home/.agents/packages/superpowers/skills'): local if local is not None else {'skill': 'new'}}
        return script['check_superpowers'](
            ('huangeddie', 'superpowers', 'main'), Path('/checkout'), Path('/home'),
            run, snapshots.__getitem__, lambda path: path != missing)

    @unittest.expectedFailure
    def test_matching_skills_return_no_staleness_after_shallow_clone(self):
        self.assertEqual(self.check(), [])
        self.assertEqual(self.calls[0], ['git', 'clone', '--quiet', '--depth', '1',
            '--branch', 'main', '--single-branch', 'https://github.com/huangeddie/superpowers.git', '/checkout'])

    @unittest.expectedFailure
    def test_changed_missing_and_extra_skills_report_staleness(self):
        for local in [{'skill': 'old'}, {}, {'skill': 'new', 'extra': 'file'}]:
            with self.subTest(local=local):
                self.assertIn('stale', ' '.join(self.check(local)))

    @unittest.expectedFailure
    def test_missing_local_skills_report_staleness(self):
        self.assertIn('Missing', ' '.join(self.check(missing=Path('/home/.agents/packages/superpowers/skills'))))

    @unittest.expectedFailure
    def test_missing_upstream_skills_raise_error(self):
        with self.assertRaisesRegex(ValueError, 'no skills'):
            self.check(missing=Path('/checkout/skills'))

    @unittest.expectedFailure
    def test_clone_failure_propagates_without_comparison(self):
        with self.assertRaisesRegex(RuntimeError, 'clone failed'):
            self.check(failure=True)


if __name__ == '__main__':
    unittest.main()
