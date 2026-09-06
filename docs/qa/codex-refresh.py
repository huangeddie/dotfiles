#!/usr/bin/env python3
"""Manual filesystem/chezmoi QA. No network, real plugins, or daemon restart."""
from pathlib import Path
import runpy
import subprocess
import tempfile

repo = Path(__file__).resolve().parents[2]
script = runpy.run_path(str(repo / 'dot_local/bin/executable_refresh-codex'))
with tempfile.TemporaryDirectory(prefix='codex-refresh-qa-') as temporary:
    root = Path(temporary)
    source, destination = root / 'source', root / 'destination'
    (source / 'dot_agents').mkdir(parents=True)
    (source / 'dot_codex').mkdir()
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
    script['refresh'](run, targets, [], restart=False)
    assert not script['pending_targets'](run(status_command)), 'GREEN: pending changes remain'
    assert (destination / '.codex/AGENTS.md').is_symlink()
    assert (destination / '.codex/AGENTS.md').read_text() == 'current instructions\n'
    script['refresh'](run, targets, [], restart=False)
    assert not script['pending_targets'](run(status_command)), 'Repeat refresh must be idempotent'
    cached = root / 'cached'
    cached.mkdir()
    (cached / 'AGENTS.md').write_text('old cache\n')
    assert script['differences'](script['snapshot'](destination / '.agents'), script['snapshot'](cached)) == ['AGENTS.md']
print('PASS: stale detection, forced apply, symlink repair, script exclusion, idempotence, cache comparison')
