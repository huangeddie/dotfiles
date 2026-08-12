#!/usr/bin/env bash
set -euo pipefail

source_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT
empty_config="$test_dir/empty-config.toml"
: >"$empty_config"

base_linux='{"machineRoles":["base"]}'
gaming_linux='{"machineRoles":["base","gaming"]}'

schema_json="$test_dir/schema.json"
chezmoi --config "$empty_config" --source "$source_dir" data --format json >"$schema_json"
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
assert_arrays "$test_dir/new-denial.sh" "$base_install" '[]'

render_linux legacy-denial '{"machineRoles":["base","gaming"],"blocked_prefixes":["steam"]}'
assert_arrays "$test_dir/legacy-denial.sh" "$base_install" '[]'

render_linux combined-denial '{"machineRoles":["base","gaming"],"packagePolicy":{"deniedPrefixes":["steam-installer"]},"blocked_prefixes":["steam-devices"]}'
assert_arrays "$test_dir/combined-denial.sh" "$base_install" '[]'

base_denied_install='["ripgrep","golang-go","fd-find","fzf","git","lazygit","gh","git-delta","curl","openssh-server","ffmpeg","npm","btop","nvtop","bat","ghostty"]'
render_linux active-role-denial '{"machineRoles":["base"],"packagePolicy":{"deniedPrefixes":["nodejs","neovim"]}}'
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

assert_render_failure \
  unsupported-role \
  '{"machineRoles":["base"],"packages":{"linux":{"apt":{"roles":{"work":[]}}}}}' \
  'packages.linux.apt.roles contains unsupported linux role "work"'
assert_render_failure \
  non-list-role \
  '{"machineRoles":["base"],"packages":{"linux":{"apt":{"roles":{"base":"neovim"}}}}}' \
  'packages.linux.apt.roles.base must be a list'
assert_render_failure \
  duplicate-ownership \
  '{"machineRoles":["base"],"packages":{"linux":{"apt":{"roles":{"base":["shared"],"gaming":["shared"]}}}}}' \
  'apt package "shared" belongs to both roles "base" and "gaming"'
assert_render_failure \
  duplicate-tombstone \
  '{"machineRoles":["base"],"packages":{"linux":{"apt":{"remove":["obsolete","obsolete"]}}}}' \
  'packages.linux.apt.remove contains duplicate package "obsolete"'
assert_render_failure \
  role-tombstone-overlap \
  '{"machineRoles":["base"],"packages":{"linux":{"apt":{"roles":{"base":["shared"]},"remove":["shared"]}}}}' \
  'apt package "shared" cannot be both role-managed and a removal tombstone'
assert_render_failure \
  custom-unsupported-role \
  '{"machineRoles":["base"],"packages":{"linux":{"custom":{"roles":{"work":[]}}}}}' \
  'packages.linux.custom.roles contains unsupported linux role "work"'
assert_render_failure \
  custom-non-list-role \
  '{"machineRoles":["base"],"packages":{"linux":{"custom":{"roles":{"base":{}}}}}}' \
  'packages.linux.custom.roles.base must be a list'
assert_render_failure \
  custom-inactive-malformed-record \
  '{"machineRoles":["base"],"packages":{"linux":{"custom":{"roles":{"gaming":[{"name":"broken","executable":"","install":"true"}]}}}}}' \
  'packages.linux.custom.roles.gaming 0: executable must not be empty'
assert_render_failure \
  custom-duplicate-within-role \
  '{"machineRoles":["base"],"packages":{"linux":{"custom":{"roles":{"base":[{"name":"shared","executable":"shared","install":"true"},{"name":"shared","executable":"other","install":"true"}]}}}}}' \
  'packages.linux.custom.roles.base contains duplicate installer "shared"'
assert_render_failure \
  custom-duplicate-ownership \
  '{"machineRoles":["base"],"packages":{"linux":{"custom":{"roles":{"base":[{"name":"shared","executable":"shared","install":"true"}],"gaming":[{"name":"shared","executable":"other","install":"true"}]}}}}}' \
  'linux custom installer "shared" belongs to both roles "base" and "gaming"'

render_linux execution '{"machineRoles":["base"]}'
fake_bin="$test_dir/fake-bin"
mkdir -p "$fake_bin"
dpkg_state="$test_dir/dpkg-state"
apt_effects="$test_dir/apt-effects"
python3 - "$dpkg_state" "$base_install" <<'PY'
import json
import sys

state_path, base_install = sys.argv[1:]
packages = json.loads(base_install)
with open(state_path, "w", encoding="utf-8") as stream:
    for package in packages:
        state = "not-installed" if package == "neovim" else "installed"
        stream.write(f"{package} {state}\n")
    stream.write("steam-installer installed\n")
    stream.write("steam-devices config-files\n")
PY

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
for executable in tv zoxide herdr tailscale bun; do
  cat >"$fake_bin/$executable" <<'SH'
#!/usr/bin/env bash
exit 0
SH
  chmod +x "$fake_bin/$executable"
done
chmod +x "$fake_bin/dpkg-query" "$fake_bin/apt-cache" "$fake_bin/apt-get" \
  "$fake_bin/apt-mark" "$fake_bin/sudo"

APT_DPKG_STATE="$dpkg_state" \
APT_EFFECTS="$apt_effects" \
PATH="$fake_bin:/usr/bin:/bin" \
  bash "$test_dir/execution.sh" >/dev/null

python3 - "$apt_effects" "$base_install" <<'PY'
import json
import sys

effects_path, base_install = sys.argv[1:]
desired = json.loads(base_install)
expected = [
    "sudo apt-get update",
    "apt-get update",
    "apt-get --simulate install -- neovim",
    "sudo apt-get install -y -- neovim",
    "apt-get install -y -- neovim",
    f"sudo apt-mark manual {' '.join(desired)}",
    f"apt-mark manual {' '.join(desired)}",
    "apt-get --simulate purge -- steam-installer steam-devices",
    "sudo apt-get purge -y -- steam-installer steam-devices",
    "apt-get purge -y -- steam-installer steam-devices",
    "sudo apt-get autoremove --purge -y",
    "apt-get autoremove --purge -y",
]
with open(effects_path, encoding="utf-8") as stream:
    actual = [line.rstrip("\n") for line in stream]
assert actual == expected, f"unexpected apt effects: {actual!r}"
PY
