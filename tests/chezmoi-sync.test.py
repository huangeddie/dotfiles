"""Deterministic unit tests; subprocesses and file snapshots are faked."""
import runpy
import subprocess
import unittest
from pathlib import Path

script = runpy.run_path(str(Path(__file__).parents[1] / 'dot_local/bin/executable_chezmoi-sync'))


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

    def test_personal_work_and_deep_configs_resolve_upstream(self):
        for location in ['', '_personal', 'some/deeply/nested/directory']:
            with self.subTest(location=location):
                self.assertEqual(self.config(location), ('huangeddie', 'superpowers', 'main'))

    def test_git_directory_is_pruned_and_missing_config_raises(self):
        def walk(root):
            dirs = ['.git']
            yield str(root), dirs, []
            if '.git' in dirs:
                yield str(root / '.git'), [], ['.chezmoiexternal.toml']
        with self.assertRaisesRegex(ValueError, 'Could not find url'):
            script['superpowers_remote'](Path('/source'), walk, lambda path: 'unused')

    def test_unrelated_section_does_not_supply_url(self):
        with self.assertRaisesRegex(ValueError, 'Could not find url'):
            self.config(content='["other"]\nurl = "https://example.com"\n')

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

    def test_matching_skills_return_no_staleness_after_shallow_clone(self):
        self.assertEqual(self.check(), [])
        self.assertEqual(self.calls[0], ['git', 'clone', '--quiet', '--depth', '1',
            '--branch', 'main', '--single-branch', 'https://github.com/huangeddie/superpowers.git', '/checkout'])

    def test_changed_missing_and_extra_skills_report_staleness(self):
        for local in [{'skill': 'old'}, {}, {'skill': 'new', 'extra': 'file'}]:
            with self.subTest(local=local):
                self.assertIn('stale', ' '.join(self.check(local)))

    def test_missing_local_skills_report_staleness(self):
        self.assertIn('Missing', ' '.join(self.check(missing=Path('/home/.agents/packages/superpowers/skills'))))

    def test_missing_upstream_skills_raise_error(self):
        with self.assertRaisesRegex(ValueError, 'no skills'):
            self.check(missing=Path('/checkout/skills'))

    def test_clone_failure_propagates_without_comparison(self):
        with self.assertRaisesRegex(RuntimeError, 'clone failed'):
            self.check(failure=True)


class CodexCliTest(unittest.TestCase):
    def test_codex_cli_is_detected_by_version_banner(self):
        calls = []
        def run(command):
            calls.append(command)
            return 'codex-cli 0.153.4\n'
        self.assertTrue(script['codex_cli_available'](run))
        self.assertEqual(calls, [['codex', '--version']])

    def test_unrelated_codex_binary_or_missing_command_is_not_codex_cli(self):
        def missing(command):
            raise FileNotFoundError('codex')
        def failing(command):
            raise subprocess.CalledProcessError(1, command)
        google_file_printer = lambda command: 'codex\nBuilt on Sep 21 2026 08:15:53\n'
        for run in (google_file_printer, missing, failing):
            with self.subTest(run=run):
                self.assertFalse(script['codex_cli_available'](run))

    def test_sync_without_codex_cli_applies_files_without_plugin_commands_or_restart(self):
        calls = []
        script['sync'](calls.append, ['/h/.agents'], [], discover=lambda: ['coding@local-agents'],
                       verify=lambda: calls.append(['verify']), codex_cli=False)
        self.assertEqual(calls, [
            ['chezmoi', 'apply', '--force', '--exclude', 'scripts', '--refresh-externals=always', '/h/.agents'],
            ['verify']])


class LayerTest(unittest.TestCase):
    layer = {'name': '_personal', 'source': Path('/work/_personal'),
             'state': Path('/config/personal-state.boltdb')}
    current = {'upstream': 'origin/main', 'ahead': 0, 'behind': 0, 'dirty': False}

    def test_missing_layer_data_uses_only_configured_source(self):
        for raw in (None, []):
            with self.subTest(raw=raw):
                self.assertEqual(script['resolve_layers'](raw, Path('/work'), Path('/config')), [])

    def test_layer_paths_resolve_relative_to_source_and_config_dirs(self):
        raw = [{'source': '_personal', 'persistentState': 'personal-state.boltdb'}]
        self.assertEqual(script['resolve_layers'](raw, Path('/work'), Path('/config')), [self.layer])
        self.assertEqual(script['layer_args'](self.layer), [
            '--source', '/work/_personal', '--persistent-state', '/config/personal-state.boltdb'])

    def test_absolute_or_malformed_layer_entries_are_rejected(self):
        for raw in ({'source': '_personal'}, [{'source': '/abs', 'persistentState': 's'}],
                    [{'source': '_personal'}], [{'source': 'a', 'persistentState': '../s'}],
                    [{'source': 'a', 'persistentState': 's', 'extra': 1}]):
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                script['resolve_layers'](raw, Path('/work'), Path('/config'))

    def test_branch_status_parses_upstream_divergence_and_tracked_changes(self):
        text = ('# branch.oid abc\n# branch.head main\n# branch.upstream origin/main\n'
                '# branch.ab +2 -3\n1 .M N... 100644 100644 100644 a b README.md\n')
        self.assertEqual(script['parse_branch_status'](text),
                         {'upstream': 'origin/main', 'ahead': 2, 'behind': 3, 'dirty': True})

    def test_branch_status_without_upstream_reports_none(self):
        self.assertEqual(script['parse_branch_status']('# branch.oid abc\n# branch.head (detached)\n'),
                         {'upstream': None, 'ahead': 0, 'behind': 0, 'dirty': False})

    def test_untracked_files_do_not_mark_layer_dirty(self):
        text = '# branch.upstream origin/main\n# branch.ab +0 -0\n? scratch.txt\n'
        self.assertFalse(script['parse_branch_status'](text)['dirty'])

    def test_layer_inspection_fetches_before_reading_status(self):
        calls = []
        def run(command):
            calls.append(command)
            return '# branch.upstream origin/main\n# branch.ab +0 -1\n' if 'status' in command else ''
        status = script['inspect_layer'](run, self.layer)
        self.assertEqual(calls, [['git', '-C', '/work/_personal', 'fetch', '--quiet'],
                                 ['git', '-C', '/work/_personal', 'status', '--porcelain=v2', '--branch']])
        self.assertEqual(status['behind'], 1)

    def test_layer_behind_upstream_is_reported_stale(self):
        stale, notices = script['layer_messages'](self.layer, dict(self.current, behind=3))
        self.assertEqual(stale, ['Layer _personal behind origin/main by 3 commits'])
        self.assertEqual(notices, [])

    def test_layer_ahead_of_upstream_reports_unpublished_commits_without_staleness(self):
        stale, notices = script['layer_messages'](self.layer, dict(self.current, ahead=2))
        self.assertEqual(stale, [])
        self.assertEqual(notices, ['Layer _personal has 2 unpublished commits'])

    def test_layer_without_upstream_reports_notice_without_staleness(self):
        stale, notices = script['layer_messages'](self.layer, dict(self.current, upstream=None))
        self.assertEqual(stale, [])
        self.assertEqual(notices, ['Layer _personal has no upstream branch; not checked'])

    def test_targets_unmanaged_by_a_source_are_excluded_from_its_commands(self):
        managed = lambda args, target: not (args == [] and target.endswith('.codex/AGENTS.md'))
        self.assertEqual(script['managed_targets'](managed, [], ['/h/.agents', '/h/.codex/AGENTS.md']),
                         ['/h/.agents'])

    def test_layers_apply_in_declared_order_before_configured_source(self):
        calls = []
        args = script['layer_args'](self.layer)
        managed = lambda source, target: source == args or target == '/h/.agents'
        script['sync'](calls.append, ['/h/.agents', '/h/.codex/AGENTS.md'], [], restart=False,
                       sources=[args, []], managed=managed)
        apply = ['apply', '--force', '--exclude', 'scripts', '--refresh-externals=always']
        self.assertEqual(calls, [['chezmoi', *args, *apply, '/h/.agents', '/h/.codex/AGENTS.md'],
                                 ['chezmoi', *apply, '/h/.agents']])

    def test_sync_fast_forwards_layers_before_applying(self):
        calls = []
        script['sync'](calls.append, ['/h/.agents'], [], restart=False,
                       layers=[(self.layer, dict(self.current, behind=1))])
        self.assertEqual(calls[0], ['git', '-C', '/work/_personal', 'merge', '--ff-only', '--quiet', '@{u}'])
        self.assertEqual(calls[1][:2], ['chezmoi', 'apply'])

    def test_current_or_ahead_layer_is_not_merged(self):
        for status in (self.current, dict(self.current, ahead=2), dict(self.current, upstream=None)):
            calls = []
            with self.subTest(status=status):
                script['sync'](calls.append, ['/h/.agents'], [], restart=False, layers=[(self.layer, status)])
                self.assertEqual([call[0] for call in calls], ['chezmoi'])

    def test_dirty_or_diverged_layer_aborts_sync_before_mutation(self):
        for status, message in ((dict(self.current, dirty=True), 'uncommitted'),
                                (dict(self.current, ahead=1, behind=1), 'diverged')):
            calls = []
            with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                script['sync'](calls.append, ['/h/.agents'], [], layers=[(self.layer, status)])
            self.assertEqual(calls, [])


if __name__ == '__main__':
    unittest.main()
