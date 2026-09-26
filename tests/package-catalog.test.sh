#!/usr/bin/env bash
set -euo pipefail
source_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
test_root=$(mktemp -d)
trap 'rm -rf "$test_root"' EXIT
: >"$test_root/empty.toml"
python3 - "$source_dir" "$test_root" <<'PY'
import copy
import json
import pathlib
import subprocess
import sys

source, temp = map(pathlib.Path, sys.argv[1:])
base = {'fd': {'role': 'base', 'install': {'linux': {'apt': ['fd-find']}, 'darwin': {'brew': 'fd'}}}}
empty = {'apt': {'install': [], 'remove': []}, 'homebrew': {'brews': [], 'casks': [], 'taps': [], 'trustedFormulae': []}, 'bun': [], 'custom': []}

def render(packages=None, removals=None, os='linux', roles=None, denied=None, legacy=None, twice=False):
    values = {'packages': base if packages is None else packages,
              'packageRemovals': {'linux': {'apt': []}} if removals is None else removals,
              'os': os, 'roles': ['base'] if roles is None else roles,
              'denied': [] if denied is None else denied,
              'legacy': [] if legacy is None else legacy}
    wrapper = '''{{- $root := deepCopy . -}}
{{- $input := %s | fromJson -}}
{{- $_ := set $root "machineRoles" $input.roles -}}
{{- $_ := set $root "packagePolicy" (dict "deniedPrefixes" $input.denied) -}}
{{- $_ := set $root "blocked_prefixes" $input.legacy -}}
{{- $_ := set $root.chezmoi "os" $input.os -}}
{{- $_ := set $root "packages" $input.packages -}}
{{- $_ := set $root "packageRemovals" $input.packageRemovals -}}
{{ includeTemplate "resolve-packages.tmpl" $root }}
''' % json.dumps(json.dumps(values))
    if twice:
        wrapper = wrapper.replace('{{ includeTemplate "resolve-packages.tmpl" $root }}',
                                  '{{- $before := $root | toJson -}}{{ includeTemplate "resolve-packages.tmpl" $root }}', 1)
        wrapper += '''{{ "\\n" }}{{ includeTemplate "resolve-packages.tmpl" $root }}
{{ "\\n" }}{{ $before }}
{{ "\\n" }}{{ $root | toJson }}
'''
    path = temp / 'case.tmpl'
    path.write_text(wrapper)
    return subprocess.run(['chezmoi', '--config', str(temp / 'empty.toml'), '--source', str(source),
                           'execute-template', '-f', str(path)], text=True, capture_output=True)

def success(name, expected, **kwargs):
    result = render(**kwargs)
    assert result.returncode == 0, (name, result.stderr)
    actual = json.loads(result.stdout)
    assert actual == expected, (name, actual, expected)

def failure(name, path, **kwargs):
    result = render(**kwargs)
    assert result.returncode != 0 and path in result.stderr, (name, result.stdout, result.stderr)

expected = copy.deepcopy(empty)
expected['apt']['install'] = ['fd-find']
expected['apt']['remove'] = ['obsolete']
success('fd Linux alias and tombstone', expected, removals={'linux': {'apt': ['obsolete']}})
expected = copy.deepcopy(empty)
expected['homebrew']['brews'] = ['fd']
success('fd Darwin alias', expected, os='darwin')
success('Darwin-only Claude absent on Linux', empty, packages={'claude-code': {'role': 'base', 'install': {'darwin': {'custom': {'executable': 'claude', 'install': 'echo hello'}}}}})
steam = {'steam': {'role': 'gaming', 'install': {'linux': {'apt': ['steam-installer', 'steam-devices']}}}}
expected = copy.deepcopy(empty); expected['apt']['install'] = ['steam-installer', 'steam-devices']
success('Steam active', expected, packages=steam, roles=['base', 'gaming'])
expected = copy.deepcopy(empty); expected['apt']['remove'] = ['steam-installer', 'steam-devices']
success('Steam inactive', expected, packages=steam)
success('Steam inactive even denied', expected, packages=steam, denied=['steam'])
expected = copy.deepcopy(empty); expected['apt']['install'] = ['steam-devices']
success('Steam partly denied', expected, packages=steam, roles=['base', 'gaming'], denied=['steam-installer'])
success('overlap legacy and new prefix', expected, packages=steam, roles=['base', 'gaming'], denied=['steam-installer'], legacy=['steam-installer'])
bun = {'pi-coding-agent': {'role': 'base', 'install': {'linux': {'bun': '@mariozechner/pi-coding-agent'}}}}
success('scoped Bun install denied', empty, packages=bun, denied=['@mariozechner'])
expected = copy.deepcopy(empty); expected['bun'] = ['@mariozechner/pi-coding-agent']
success('logical ID denied but install retained', expected, packages=bun, denied=['pi-coding-agent'])
success('native logical ID denied but install retained', {'apt': {'install': ['fd-find'], 'remove': []}, 'homebrew': empty['homebrew'], 'bun': [], 'custom': []}, packages={'finder': base['fd']}, denied=['finder'])
trust = {'hunk': {'role': 'base', 'install': {'darwin': {'brew': 'modem-dev/tap/hunk', 'trusted': True}}}}
success('trusted brew denied', empty, packages=trust, os='darwin', denied=['modem-dev'])
expected = copy.deepcopy(empty); expected['homebrew']['brews'] = ['modem-dev/tap/hunk']; expected['homebrew']['trustedFormulae'] = ['modem-dev/tap/hunk']
success('trusted brew selected', expected, packages=trust, os='darwin')
taps = {'a': {'role': 'base', 'install': {'darwin': {'brew': 'a', 'tap': 'vendor/tap'}}}, 'b': {'role': 'base', 'install': {'darwin': {'cask': 'b', 'tap': 'vendor/tap'}}}}
expected = copy.deepcopy(empty); expected['homebrew'].update(brews=['a'], casks=['b'], taps=['vendor/tap'])
success('shared tap', expected, packages=taps, os='darwin')
expected['homebrew']['taps'] = []
success('denied tap', expected, packages=taps, os='darwin', denied=['vendor'])
custom = {key: {'role': 'base', 'install': {'linux': recipe}} for key, recipe in {
    'z': {'custom': {'executable': 'z', 'install': 'echo z'}, 'order': 20},
    'b': {'custom': {'executable': 'b', 'install': 'echo b'}, 'order': 10},
    'a': {'custom': {'executable': 'a', 'install': 'echo a', 'setup': 'echo setup'}},
    'c': {'custom': {'executable': 'c', 'install': 'echo c'}, 'order': 10},
}.items()}
expected = copy.deepcopy(empty); expected['custom'] = [{'name': name, **custom[name]['install']['linux']['custom']} for name in ('a', 'b', 'c', 'z')]
success('custom numeric order tie and setup', expected, packages=custom)
result = render(packages=custom, twice=True)
assert result.returncode == 0, result.stderr
first, second, before, after = map(json.loads, filter(str.strip, result.stdout.splitlines()))
assert first == second == expected and before == after, 'resolver mutated its root'

invalid = [
    ('root packages type', 'packages', {'packages': []}),
    ('root removals type', 'packageRemovals', {'removals': []}),
    ('unknown OS', 'operating system', {'os': 'freebsd'}),
    ('unknown selected role', 'machine role', {'roles': ['base', 'unknown']}),
    ('empty entry recipes', 'packages.fd.install', {'packages': {'fd': {'role': 'base', 'install': {}}}}),
    ('empty root removals', 'packageRemovals.linux', {'removals': {}}),
    ('unknown removal installer', 'packageRemovals.linux.brew', {'removals': {'linux': {'apt': [], 'brew': []}}}),
    ('entry map', 'packages.fd', {'packages': {'fd': []}}),
    ('entry unknown key', 'packages.fd.extra', {'packages': {'fd': {'role': 'base', 'install': {'linux': {'apt': ['fd']}}, 'extra': 1}}}),
    ('entry blank ID', 'packages. fd ', {'packages': {' fd ': base['fd']}}),
    ('missing install', 'packages.fd.install', {'packages': {'fd': {'role': 'base'}}}),
    ('unknown role', 'packages.fd.role', {'packages': {'fd': {'role': 'work', 'install': {'linux': {'apt': ['fd']}}}}}),
    ('unknown platform', 'packages.fd.install.windows', {'packages': {'fd': {'role': 'base', 'install': {'windows': {'bun': 'fd'}}}}}),
    ('gaming Darwin', 'packages.fd.install.darwin', {'packages': {'fd': {'role': 'gaming', 'install': {'darwin': {'brew': 'fd'}}}}}),
    ('unselected malformed', 'packages.fd.install.darwin', {'packages': {'fd': {'role': 'base', 'install': {'linux': {'apt': ['fd']}, 'darwin': {'brew': 1}}}}}),
    ('unknown recipe field', 'packages.fd.install.linux.other', {'packages': {'fd': {'role': 'base', 'install': {'linux': {'apt': ['fd'], 'other': 1}}}}}),
    ('no installer', 'packages.fd.install.linux', {'packages': {'fd': {'role': 'base', 'install': {'linux': {}}}}}),
    ('multiple installers', 'packages.fd.install.linux', {'packages': {'fd': {'role': 'base', 'install': {'linux': {'apt': ['fd'], 'bun': 'fd'}}}}}),
    ('apt on Darwin', 'packages.fd.install.darwin.apt', {'packages': {'fd': {'role': 'base', 'install': {'darwin': {'apt': ['fd']}}}}}),
    ('brew Linux', 'packages.fd.install.linux.brew', {'packages': {'fd': {'role': 'base', 'install': {'linux': {'brew': 'fd'}}}}}),
    ('cask Linux', 'packages.fd.install.linux.cask', {'packages': {'fd': {'role': 'base', 'install': {'linux': {'cask': 'fd'}}}}}),
    ('padded name', 'packages.fd.install.linux.apt', {'packages': {'fd': {'role': 'base', 'install': {'linux': {'apt': [' fd']}}}}}),
    ('empty apt', 'packages.fd.install.linux.apt', {'packages': {'fd': {'role': 'base', 'install': {'linux': {'apt': []}}}}}),
    ('duplicate apt', 'packages.fd.install.linux.apt', {'packages': {'fd': {'role': 'base', 'install': {'linux': {'apt': ['fd', 'fd']}}}}}),
    ('invalid trust', 'packages.fd.install.darwin.trusted', {'packages': {'fd': {'role': 'base', 'install': {'darwin': {'brew': 'fd', 'trusted': 'true'}}}}}),
    ('trust nonbrew', 'packages.fd.install.linux.trusted', {'packages': {'fd': {'role': 'base', 'install': {'linux': {'bun': 'fd', 'trusted': True}}}}}),
    ('tap apt', 'packages.fd.install.linux.tap', {'packages': {'fd': {'role': 'base', 'install': {'linux': {'apt': ['fd'], 'tap': 'x'}}}}}),
    ('tap bun', 'packages.fd.install.linux.tap', {'packages': {'fd': {'role': 'base', 'install': {'linux': {'bun': 'fd', 'tap': 'x'}}}}}),
    ('tap custom', 'packages.fd.install.linux.tap', {'packages': {'fd': {'role': 'base', 'install': {'linux': {'custom': {'executable': 'fd', 'install': 'echo x'}, 'tap': 'x'}}}}}),
    ('blank tap', 'packages.fd.install.darwin.tap', {'packages': {'fd': {'role': 'base', 'install': {'darwin': {'brew': 'fd', 'tap': ' '}}}}}),
    ('fraction order', 'packages.fd.install.linux.order', {'packages': {'fd': {'role': 'base', 'install': {'linux': {'custom': {'executable': 'fd', 'install': 'echo x'}, 'order': 1.5}}}}}),
    ('negative order', 'packages.fd.install.linux.order', {'packages': {'fd': {'role': 'base', 'install': {'linux': {'custom': {'executable': 'fd', 'install': 'echo x'}, 'order': -1}}}}}),
    ('string order', 'packages.fd.install.linux.order', {'packages': {'fd': {'role': 'base', 'install': {'linux': {'custom': {'executable': 'fd', 'install': 'echo x'}, 'order': '1'}}}}}),
    ('native order', 'packages.fd.install.linux.order', {'packages': {'fd': {'role': 'base', 'install': {'linux': {'apt': ['fd'], 'order': 1}}}}}),
    ('missing executable', 'packages.fd.install.linux.custom', {'packages': {'fd': {'role': 'base', 'install': {'linux': {'custom': {'install': 'echo x'}}}}}}),
    ('missing install script', 'packages.fd.install.linux.custom', {'packages': {'fd': {'role': 'base', 'install': {'linux': {'custom': {'executable': 'fd'}}}}}}),
    ('unknown custom field', 'packages.fd.install.linux.custom.extra', {'packages': {'fd': {'role': 'base', 'install': {'linux': {'custom': {'executable': 'fd', 'install': 'echo x', 'extra': 1}}}}}}),
    ('duplicate owner', 'packages.b.install.linux.apt', {'packages': {'a': {'role': 'base', 'install': {'linux': {'apt': ['same']}}}, 'b': {'role': 'gaming', 'install': {'linux': {'apt': ['same']}}}}}),
    ('duplicate tombstone', 'packageRemovals.linux.apt', {'removals': {'linux': {'apt': ['old', 'old']}}}),
    ('padded tombstone', 'packageRemovals.linux.apt', {'removals': {'linux': {'apt': [' old']}}}),
    ('tombstone overlap', 'packageRemovals.linux.apt', {'removals': {'linux': {'apt': ['fd-find']}}, 'denied': ['fd']}),
    ('unknown removals platform', 'packageRemovals.darwin', {'removals': {'darwin': {'apt': []}}}),
]
for name, path, params in invalid:
    failure(name, path, **params)
print('package catalog: synthetic resolution, schema and purity contracts passed')
PY
