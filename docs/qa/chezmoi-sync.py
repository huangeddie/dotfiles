#!/usr/bin/env python3
"""Manual filesystem/chezmoi QA. No network, real plugins, or daemon restart."""
from pathlib import Path
import os
import runpy
import subprocess
import tempfile

repo = Path(__file__).resolve().parents[2]
script = runpy.run_path(str(repo / 'dot_local/bin/executable_chezmoi-sync'))
with tempfile.TemporaryDirectory(prefix='chezmoi-sync-qa-') as temporary:
    root = Path(temporary)
    source, destination = root / 'source', root / 'destination'
    (source / 'dot_agents').mkdir(parents=True)
    (source / 'dot_codex').mkdir()
    manifest = source / 'dot_agents/exact_packages/example/dot_codex-plugin/plugin.json'
    manifest.parent.mkdir(parents=True)
    manifest.write_text('{"name": "example", "skills": "./skills/"}')
    (source / 'dot_agents/exact_packages/non-codex').mkdir()
    (source / 'dot_agents/exact_packages/non-codex/README.md').write_text('No Codex manifest')
    (destination / '.agents').mkdir(parents=True)
    (destination / '.codex').mkdir()
    (source / 'dot_agents/AGENTS.md').write_text('current instructions\n')
    (source / 'dot_codex/symlink_AGENTS.md').write_text('../.agents/AGENTS.md\n')
    (destination / '.agents/AGENTS.md').write_text('stale instructions\n')
    (destination / '.codex/AGENTS.md').write_text('stale copy\n')
    # A targeted refresh must not execute unrelated chezmoi hooks.
    (source / 'run_before_fail.sh').write_text('#!/bin/sh\nexit 99\n')
    config = root / 'chezmoi.toml'
    config.write_text('')
    def run(command):
        assert command[0] == 'chezmoi', command
        actual = ['chezmoi', '--source', str(source), '--destination', str(destination),
                  '--config', str(config), '--cache', str(root / 'cache'),
                  '--persistent-state', str(root / 'state'), *command[1:]]
        return subprocess.run(actual, check=True, capture_output=True, text=True).stdout
    targets = [str(destination / '.agents'), str(destination / '.codex/AGENTS.md')]
    status_command = ['chezmoi', 'status', '--exclude', 'scripts', '--refresh-externals=never', *targets]
    assert script['pending_targets'](run(status_command)), 'RED: stale fixture must be detected'
    script['sync'](run, targets, [], restart=False)
    assert not script['pending_targets'](run(status_command)), 'GREEN: pending changes remain'
    assert script['package_plugins'](destination) == ['example@local-agents']
    assert script['missing_plugins'](script['package_plugins'](destination), []) == ['example@local-agents']
    assert (destination / '.codex/AGENTS.md').is_symlink()
    assert (destination / '.codex/AGENTS.md').read_text() == 'current instructions\n'
    script['sync'](run, targets, [], restart=False)
    assert not script['pending_targets'](run(status_command)), 'Repeat refresh must be idempotent'
    cached = root / 'cached'
    cached.mkdir()
    (cached / 'AGENTS.md').write_text('old cache\n')
    assert 'AGENTS.md' in script['differences'](script['snapshot'](destination / '.agents'), script['snapshot'](cached))
    external = source / '_personal/.chezmoiexternal.toml'
    external.parent.mkdir()
    external.write_text('[".agents/packages/superpowers/skills"]\n'
                        'url = "https://github.com/example/skills/archive/refs/heads/main.tar.gz"\n')
    remote = script['superpowers_remote'](source, os.walk, Path.read_text)
    assert remote == ('example', 'skills', 'main')
    upstream = root / 'upstream'
    (upstream / 'skills').mkdir(parents=True)
    (upstream / 'skills/SKILL.md').write_text('current skill\n')
    def git(*args):
        return subprocess.run(['git', *args], check=True, capture_output=True, text=True).stdout
    git('init', '-b', 'main', str(upstream))
    git('-C', str(upstream), 'add', '.')
    git('-C', str(upstream), '-c', 'user.name=QA', '-c', 'user.email=qa@example.com',
        '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture')
    def local_git(command):
        args = command[1:]
        if args[0] == 'clone':
            args[-2] = upstream.as_uri()
        return git(*args)
    local_skills = destination / '.agents/packages/superpowers/skills'
    local_skills.mkdir(parents=True)
    (local_skills / 'SKILL.md').write_text('stale skill\n')
    assert script['check_superpowers'](remote, root / 'clone-red', destination,
                                      local_git, script['snapshot'], Path.is_dir)
    (local_skills / 'SKILL.md').write_text('current skill\n')
    assert not script['check_superpowers'](remote, root / 'clone-green', destination,
                                          local_git, script['snapshot'], Path.is_dir)

    # Layered sources: a nested layer tracks a real upstream; the configured
    # source overlays .agents but does not manage .codex/AGENTS.md.
    identity = ['-c', 'user.name=QA', '-c', 'user.email=qa@example.com', '-c', 'commit.gpgsign=false']
    def commit(checkout, message):
        git('-C', str(checkout), 'add', '.')
        git('-C', str(checkout), *identity, 'commit', '-q', '-m', message)
    bare, author, work = root / 'layer.git', root / 'layer-author', root / 'work'
    git('init', '-q', '--bare', '-b', 'main', str(bare))
    git('clone', '-q', bare.as_uri(), str(author))
    (author / 'dot_agents').mkdir()
    (author / 'dot_codex').mkdir()
    (author / 'dot_agents/AGENTS.md').write_text('layer v1\n')
    (author / 'dot_codex/symlink_AGENTS.md').write_text('../.agents/AGENTS.md\n')
    commit(author, 'v1')
    git('-C', str(author), 'push', '-q', 'origin', 'HEAD:main')
    (work / 'dot_agents/hooks').mkdir(parents=True)
    (work / 'dot_agents/hooks/hook.sh').write_text('work hook\n')
    (work / '.chezmoiignore').write_text('_personal/\n')
    git('clone', '-q', bare.as_uri(), str(work / '_personal'))
    (author / 'dot_agents/AGENTS.md').write_text('layer v2\n')
    commit(author, 'v2')
    git('-C', str(author), 'push', '-q', 'origin', 'HEAD:main')
    layered_home = root / 'layered-home'
    (layered_home / '.codex').mkdir(parents=True)
    layer = script['resolve_layers']([{'source': '_personal', 'persistentState': 'layer-state'}], work, root)[0]
    def chezmoi_command(command):
        extra = [] if '--source' in command else ['--source', str(work), '--persistent-state', str(root / 'work-state')]
        return ['chezmoi', '--destination', str(layered_home), '--config', str(config),
                '--cache', str(root / 'layered-cache'), *extra, *command[1:]]
    def layered_run(command):
        if command[0] == 'git':
            return git(*command[1:])
        return subprocess.run(chezmoi_command(command), check=True, capture_output=True, text=True).stdout
    def managed(args, target):
        command = chezmoi_command(['chezmoi', *args, 'source-path', target])
        return subprocess.run(command, capture_output=True).returncode == 0
    layered_targets = [str(layered_home / '.agents'), str(layered_home / '.codex/AGENTS.md')]
    assert script['managed_targets'](managed, [], layered_targets) == layered_targets[:1]
    status = script['inspect_layer'](layered_run, layer)
    assert script['layer_messages'](layer, status)[0] == ['Layer _personal behind origin/main by 1 commits'], status
    (work / '_personal/dot_agents/AGENTS.md').write_text('local edit\n')
    dirty = script['inspect_layer'](layered_run, layer)
    try:
        script['sync'](layered_run, layered_targets, [], restart=False, layers=[(layer, dirty)],
                       sources=[script['layer_args'](layer), []], managed=managed)
        raise AssertionError('RED: dirty layer must abort sync')
    except ValueError as error:
        assert 'uncommitted' in str(error), error
    assert not (layered_home / '.agents').exists(), 'Dirty layer abort must precede apply'
    git('-C', str(work / '_personal'), 'checkout', '-q', '--', '.')
    script['sync'](layered_run, layered_targets, [], restart=False,
                   layers=[(layer, script['inspect_layer'](layered_run, layer))],
                   sources=[script['layer_args'](layer), []], managed=managed)
    assert (layered_home / '.agents/AGENTS.md').read_text() == 'layer v2\n'
    assert (layered_home / '.agents/hooks/hook.sh').read_text() == 'work hook\n'
    assert (layered_home / '.codex/AGENTS.md').is_symlink()
    assert script['layer_messages'](layer, script['inspect_layer'](layered_run, layer)) == ([], [])
print('PASS: stale detection, forced apply, symlink repair, script exclusion, idempotence, manifest discovery, cache comparison, nested external discovery, local Git upstream red/green, layer upstream fast-forward, layered apply with managed filtering, dirty layer guard')
