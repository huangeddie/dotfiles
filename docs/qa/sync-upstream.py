#!/usr/bin/env python3
"""Manual filesystem/chezmoi QA. No network, real plugins, or daemon restart."""
from pathlib import Path
import os
import runpy
import subprocess
import tempfile

repo = Path(__file__).resolve().parents[2]
script = runpy.run_path(str(repo / 'dot_local/bin/executable_sync-upstream'))
with tempfile.TemporaryDirectory(prefix='sync-upstream-qa-') as temporary:
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
print('PASS: stale detection, forced apply, symlink repair, script exclusion, idempotence, manifest discovery, cache comparison, nested external discovery, local Git upstream red/green')
