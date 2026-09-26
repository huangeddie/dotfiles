#!/usr/bin/env bash
set -euo pipefail

source_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT
empty_config="$test_dir/empty-config.toml"
: >"$empty_config"

base_linux='{"chezmoi":{"os":"linux"},"machineRoles":["base"]}'
execution_linux='{"chezmoi":{"os":"linux"},"machineRoles":["base"]}'
gaming_linux='{"chezmoi":{"os":"linux"},"machineRoles":["base","gaming"]}'

schema_json="$test_dir/schema.json"
chezmoi --config "$empty_config" --source "$source_dir" data --format json >"$schema_json"
python3 - "$schema_json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as stream:
    packages = json.load(stream)["packages"]

assert packages["steam"]["install"]["linux"]["apt"] == ["steam-installer", "steam-devices"]
assert packages["nvtop"]["install"]["linux"]["apt"] == ["nvtop"]
PY

render_linux() {
  local name=$1
  local override=$2
  chezmoi --config "$empty_config" --source "$source_dir" --override-data "$override" \
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
    match = re.search(rf"^{name}=\(\n(.*?)^\)", script, re.MULTILINE | re.DOTALL)
    if not match:
        raise AssertionError(f"missing {name} array")
    return [shlex.split(line)[0] for line in match.group(1).splitlines() if line.strip()]

assert sorted(array("apt_install_packages")) == sorted(json.loads(expected_install))
assert sorted(array("apt_remove_packages")) == sorted(json.loads(expected_remove))
PY
}

base_install=$(python3 - "$source_dir/tests/fixtures/packages/baseline.json" <<'PY'
import json, sys
print(json.dumps(json.load(open(sys.argv[1]))["linux-base"]["apt"]["install"]))
PY
)
gaming_install=$(python3 - "$source_dir/tests/fixtures/packages/baseline.json" <<'PY'
import json, sys
print(json.dumps(json.load(open(sys.argv[1]))["linux-gaming"]["apt"]["install"]))
PY
)
steam_purge=$(python3 - "$source_dir/tests/fixtures/packages/baseline.json" <<'PYJSON'
import json,sys
print(json.dumps(json.load(open(sys.argv[1]))['linux-base']['apt']['remove']))
PYJSON
)

render_linux base "$base_linux"
assert_arrays "$test_dir/base.sh" "$base_install" "$steam_purge"

render_linux gaming "$gaming_linux"
assert_arrays "$test_dir/gaming.sh" "$gaming_install" '[]'

render_linux new-denial '{"chezmoi":{"os":"linux"},"machineRoles":["base","gaming"],"packagePolicy":{"deniedPrefixes":["steam"]}}'
assert_arrays "$test_dir/new-denial.sh" "$base_install" '[]'

render_linux legacy-denial '{"chezmoi":{"os":"linux"},"machineRoles":["base","gaming"],"blocked_prefixes":["steam"]}'
assert_arrays "$test_dir/legacy-denial.sh" "$base_install" '[]'

render_linux combined-denial '{"chezmoi":{"os":"linux"},"machineRoles":["base","gaming"],"packagePolicy":{"deniedPrefixes":["steam-installer"]},"blocked_prefixes":["steam-devices"]}'
assert_arrays "$test_dir/combined-denial.sh" "$base_install" '[]'

base_denied_install=$(python3 - "$source_dir/tests/fixtures/packages/baseline.json" <<'PY'
import json, sys
print(json.dumps([name for name in json.load(open(sys.argv[1]))["linux-base"]["apt"]["install"] if name not in ("nodejs", "neovim")]))
PY
)
render_linux active-role-denial '{"chezmoi":{"os":"linux"},"machineRoles":["base"],"packagePolicy":{"deniedPrefixes":["nodejs","neovim"]}}'
assert_arrays "$test_dir/active-role-denial.sh" "$base_denied_install" "$steam_purge"

assert_render_failure() {
  local name=$1
  local override=$2
  local expected_error=$3

  if chezmoi --config "$empty_config" --source "$source_dir" --override-data "$override" \
    execute-template \
    -f "$source_dir/run_onchange_before_linux-install-packages.sh.tmpl" \
    >"$test_dir/$name.out" 2>"$test_dir/$name.err"; then
    echo "Linux renderer accepted invalid apt declaration: $name" >&2
    exit 1
  fi
  grep -Fq "$expected_error" "$test_dir/$name.err"
}

assert_render_failure shared-catalog-validation '{"chezmoi":{"os":"linux"},"machineRoles":["base"],"packages":{"steam":{"unexpected":true}}}' 'packages.steam.unexpected'

execution_source="$test_dir/execution-source"
mkdir -p "$execution_source"
cp -R "$source_dir/.chezmoitemplates" "$source_dir/.chezmoidata" "$execution_source/"
cp "$source_dir/run_onchange_before_linux-install-packages.sh.tmpl" "$execution_source/"
cat >"$execution_source/.chezmoidata/packages.yaml" <<'JSON'
{"machineRolePolicy":{"required":["base"],"platforms":{"linux":["base","gaming"],"darwin":["base"]}},"packages":{"editor":{"role":"base","install":{"linux":{"apt":["neovim"]}}},"steam":{"role":"gaming","install":{"linux":{"apt":["steam-installer","steam-devices"]}}}},"packageRemovals":{"linux":{"apt":[]}}}
JSON
chezmoi --config "$empty_config" --source "$execution_source" --override-data "$execution_linux" \
  execute-template -f "$execution_source/run_onchange_before_linux-install-packages.sh.tmpl" >"$test_dir/execution.sh"
bash -n "$test_dir/execution.sh"
if grep -Eq 'alexpasmantier\.github\.io|ajeetdsouza/zoxide|herdr\.dev/install|tailscale\.com/install|bun\.com/install|sh\.rustup\.rs' "$test_dir/execution.sh"; then
  echo "production custom installer in execution script" >&2; exit 1
fi
supported_bash=
for candidate in /opt/homebrew/bin/bash /usr/local/bin/bash /bin/bash; do
  if [[ -x $candidate ]] && "$candidate" -c 'declare -A package_states=()' 2>/dev/null; then
    supported_bash=$candidate
    break
  fi
done
if [[ -z $supported_bash ]]; then
  echo 'SKIP Linux fake apt execution: Bash with associative arrays is unavailable' >&2
else
fake_bin="$test_dir/fake-bin"
mkdir -p "$fake_bin"
dpkg_state="$test_dir/dpkg-state"
apt_effects="$test_dir/apt-effects"
cat >"$dpkg_state" <<'STATE'
neovim not-installed
steam-installer installed
steam-devices config-files
STATE

cat >"$fake_bin/dpkg-query" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
package=${!#}
state=$(awk -v package="$package" '$1 == package { print $2 }' "$APT_DPKG_STATE")
printf 'install ok %s\n' "${state:-not-installed}"
SH
cat >"$fake_bin/apt-cache" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
[[ ${1-} == show && ${2-} == neovim ]]
SH
cat >"$fake_bin/apt-get" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'apt-get %s\n' "$*" >>"$APT_EFFECTS"
if [[ ${1-} == --simulate ]]; then
  case ${2-} in
    install) printf '0 to remove\n' ;;
    purge)
      printf 'Remv steam-installer [1.0]\nPurg steam-devices [1.0]\n2 to remove\n'
      ;;
  esac
elif [[ ${1-} == install ]]; then
  awk '$1 != "neovim"' "$APT_DPKG_STATE" >"$APT_DPKG_STATE.next"
  printf 'neovim installed\n' >>"$APT_DPKG_STATE.next"
  mv "$APT_DPKG_STATE.next" "$APT_DPKG_STATE"
fi
SH
cat >"$fake_bin/apt-mark" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'apt-mark %s\n' "$*" >>"$APT_EFFECTS"
SH
cat >"$fake_bin/sudo" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'sudo %s\n' "$*" >>"$APT_EFFECTS"
"$@"
SH
for executable in curl wget; do
  printf '#!/bin/sh\necho "network forbidden in unit tests" >&2\nexit 97\n' >"$fake_bin/$executable"
  chmod +x "$fake_bin/$executable"
done
chmod +x "$fake_bin/dpkg-query" "$fake_bin/apt-cache" "$fake_bin/apt-get" \
  "$fake_bin/apt-mark" "$fake_bin/sudo"

mkdir -p "$test_dir/home" "$test_dir/config"
APT_DPKG_STATE="$dpkg_state" \
APT_EFFECTS="$apt_effects" \
HOME="$test_dir/home" XDG_CONFIG_HOME="$test_dir/config" \
PATH="$fake_bin:/usr/bin:/bin" \
  "$supported_bash" "$test_dir/execution.sh" >/dev/null

python3 - "$apt_effects" <<'PY'
import sys
actual = open(sys.argv[1], encoding='utf-8').read().splitlines()
expected = [
    'sudo apt-get update', 'apt-get update',
    'apt-get --simulate install -- neovim',
    'sudo apt-get install -y -- neovim', 'apt-get install -y -- neovim',
    'sudo apt-mark manual neovim', 'apt-mark manual neovim',
    'apt-get --simulate purge -- steam-installer steam-devices',
    'sudo apt-get purge -y -- steam-installer steam-devices',
    'apt-get purge -y -- steam-installer steam-devices',
    'sudo apt-get autoremove --purge -y', 'apt-get autoremove --purge -y',
]
assert actual == expected, (actual, expected)
PY
fi
