#!/usr/bin/env bash
set -euo pipefail

source_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT

base_linux='{"machineRoles":["base"]}'
gaming_linux='{"machineRoles":["base","gaming"]}'

schema_json="$test_dir/schema.json"
chezmoi --source "$source_dir" data --format json >"$schema_json"
python3 - "$schema_json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as stream:
    packages = json.load(stream)["packages"]

assert packages["linux"]["apt"]["roles"]["gaming"] == [
    "steam-installer",
    "steam-devices",
]
assert "nvtop" in packages["linux"]["apt"]["roles"]["base"]
assert packages["linux"]["apt"]["remove"] == []
PY

render_linux() {
  local name=$1
  local override=$2
  chezmoi --source "$source_dir" --override-data "$override" \
    execute-template \
    -f "$source_dir/run_onchange_before_linux-install-packages.sh.tmpl" \
    >"$test_dir/$name.sh"
  bash -n "$test_dir/$name.sh"
}

assert_arrays() {
  local script=$1
  local expected_install=$2
  local expected_remove=$3
  python3 - "$script" "$expected_install" "$expected_remove" <<'PY'
import json
import re
import shlex
import sys

script_path, expected_install, expected_remove = sys.argv[1:]
script = open(script_path, encoding="utf-8").read()

def array(name):
    match = re.search(rf"^{name}=\\(\\n(.*?)^\\)", script, re.MULTILINE | re.DOTALL)
    if not match:
        raise AssertionError(f"missing {name} array")
    return [shlex.split(line)[0] for line in match.group(1).splitlines() if line.strip()]

assert array("apt_install_packages") == json.loads(expected_install)
assert array("apt_remove_packages") == json.loads(expected_remove)
PY
}

base_install='["neovim","ripgrep","golang-go","fd-find","fzf","git","lazygit","gh","git-delta","curl","openssh-server","ffmpeg","nodejs","npm","btop","nvtop","bat","ghostty"]'
gaming_install='["neovim","ripgrep","golang-go","fd-find","fzf","git","lazygit","gh","git-delta","curl","openssh-server","ffmpeg","nodejs","npm","btop","nvtop","bat","ghostty","steam-installer","steam-devices"]'
steam_purge='["steam-installer","steam-devices"]'

render_linux base "$base_linux"
assert_arrays "$test_dir/base.sh" "$base_install" "$steam_purge"

render_linux gaming "$gaming_linux"
assert_arrays "$test_dir/gaming.sh" "$gaming_install" '[]'

render_linux new-denial '{"machineRoles":["base","gaming"],"packagePolicy":{"deniedPrefixes":["steam"]}}'
assert_arrays "$test_dir/new-denial.sh" "$base_install" "$steam_purge"

render_linux legacy-denial '{"machineRoles":["base","gaming"],"blocked_prefixes":["steam"]}'
assert_arrays "$test_dir/legacy-denial.sh" "$base_install" "$steam_purge"

render_linux combined-denial '{"machineRoles":["base","gaming"],"packagePolicy":{"deniedPrefixes":["steam-installer"]},"blocked_prefixes":["steam-devices"]}'
assert_arrays "$test_dir/combined-denial.sh" "$base_install" "$steam_purge"
