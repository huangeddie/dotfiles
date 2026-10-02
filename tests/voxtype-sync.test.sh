#!/usr/bin/env bash
set -euo pipefail
source_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
test_root=$(mktemp -d)
trap 'rm -rf "$test_root"' EXIT
python3 - "$source_dir" "$test_root" <<'PY'
import os
import pathlib
import shutil
import subprocess
import sys

source, temp = map(pathlib.Path, sys.argv[1:])
fixture = temp / 'source'
fixture.mkdir()
shutil.copy(source / 'run_onchange_after_voxtype-sync.sh.tmpl', fixture)
config = fixture / 'dot_config/voxtype/config.toml'
config.parent.mkdir(parents=True)
units = fixture / 'dot_config/systemd/user'
units.mkdir(parents=True)
for name in ('dotoold', 'voxtype'):
    (units / (name + '.service')).write_text('[Service]\n')
empty_config = temp / 'empty.toml'
empty_config.write_text('')
home = temp / 'home'
(home / '.config/voxtype').mkdir(parents=True)
(home / '.config/voxtype/config.toml').write_text('')
(home / '.local/bin').mkdir(parents=True)
fake_bin = temp / 'bin'
fake_bin.mkdir()

def executable(path, body):
    path.write_text('#!/bin/bash\n' + body)
    path.chmod(0o755)

executable(fake_bin / 'python3', 'echo "Runtime Python is forbidden" >&2\nexit 97\n')
executable(fake_bin / 'voxtype', 'printf "%s\\n" "$@" >>"$VOXTYPE_CALLS"\n')
executable(fake_bin / 'systemctl', 'printf "%s\\n" "$*" >>"$SERVICE_CALLS"\n')
executable(home / '.local/bin/dotoold', 'exit 0\n')

def check(name, toml, model, platform='darwin'):
    config.write_text(toml)
    rendered = subprocess.run([
        'chezmoi', '--config', str(empty_config), '--source', str(fixture),
        '--override-data', '{"chezmoi":{"os":"' + platform + '"}}',
        'execute-template', '-f', str(fixture / 'run_onchange_after_voxtype-sync.sh.tmpl'),
    ], text=True, capture_output=True)
    assert rendered.returncode == 0, (name, rendered.stderr)
    script = temp / 'sync.sh'
    script.write_text(rendered.stdout)
    calls, services = temp / 'calls', temp / 'services'
    calls.write_text('')
    services.write_text('')
    result = subprocess.run(['/bin/bash', str(script)], text=True, capture_output=True, env={
        **os.environ, 'HOME': str(home), 'PATH': str(fake_bin) + ':/usr/bin:/bin',
        'VOXTYPE_CALLS': str(calls), 'SERVICE_CALLS': str(services),
    })
    assert result.returncode == 0, (name, result.stderr)
    expected = ['setup', '--download', '--model', model, '--no-post-install'] if model else []
    assert calls.read_text().splitlines() == expected, (name, calls.read_text())
    expected_services = [
        '--user daemon-reload', '--user enable --now dotoold.service voxtype.service',
        '--user restart voxtype.service',
    ] if platform == 'linux' else []
    assert services.read_text().splitlines() == expected_services, (name, services.read_text())
    print('PASS ' + name)

check('selected model downloads without runtime Python',
      'engine = "parakeet"\n[parakeet]\nmodel = "selected-model"\n[whisper]\nmodel = "other-model"\n', 'selected-model')
check('missing engine selects whisper model', '[whisper]\nmodel = "base.en"\n', 'base.en')
check('missing engine section skips download', 'engine = "parakeet"\n', None)
check('missing model skips download', '[whisper]\nlanguage = "en"\n', None)
check('empty model skips download', '[whisper]\nmodel = ""\n', None)
check('model shell characters remain a literal argument',
      '''[whisper]\nmodel = "a'b $HOME $(exit 98) `exit 99`"\n''', "a'b $HOME $(exit 98) `exit 99`")
check('Linux downloads model and restarts services without Python',
      '[whisper]\nmodel = "base.en"\n', 'base.en', platform='linux')
PY
