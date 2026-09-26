#!/usr/bin/env bash
set -euo pipefail

source_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
test_root=$(mktemp -d)
trap 'rm -rf "$test_root"' EXIT
empty_config="$test_root/empty-config.toml"
: >"$empty_config"

base_linux='{"chezmoi":{"os":"linux"},"machineRoles":["base"]}'

schema_json="$test_root/schema.json"
chezmoi --config "$empty_config" --source "$source_dir" data --format json >"$schema_json"
python3 - "$schema_json" "$source_dir/tests/fixtures/packages/baseline.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as stream:
    packages = json.load(stream)["packages"]

with open(sys.argv[2], encoding="utf-8") as stream:
    expected = json.load(stream)
assert sorted(packages["bun"]["global"]["roles"]["base"]) == expected["linux-base"]["bun"]
assert expected["linux-base"]["bun"] == expected["darwin-base"]["bun"]
assert "bun" in packages["darwin"]["brews"]["roles"]["base"]
PY

linux_script="$test_root/linux-install-packages.sh"
chezmoi --config "$empty_config" --source "$source_dir" --override-data "$base_linux" \
  execute-template \
  -f "$source_dir/run_onchange_before_linux-install-packages.sh.tmpl" \
  >"$linux_script"
grep -Fqx '  curl -fsSL https://bun.com/install | bash' "$linux_script"

render_bun() {
  local name=$1
  local override=$2
  chezmoi --config "$empty_config" --source "$source_dir" --override-data "$override" \
    execute-template \
    -f "$source_dir/run_onchange_after_install-bun-global-packages.sh.tmpl" \
    >"$test_root/$name.sh"
  bash -n "$test_root/$name.sh"
}

assert_render_failure() {
  local name=$1
  local override=$2
  local expected_error=$3

  if chezmoi --config "$empty_config" --source "$source_dir" --override-data "$override" \
    execute-template \
    -f "$source_dir/run_onchange_after_install-bun-global-packages.sh.tmpl" \
    >"$test_root/$name.out" 2>"$test_root/$name.err"; then
    echo "Bun renderer accepted invalid declaration: $name" >&2
    exit 1
  fi
  grep -Fq "$expected_error" "$test_root/$name.err"
}

render_bun base "$base_linux"

assert_render_failure unsupported-role \
  '{"chezmoi":{"os":"linux"},"machineRoles":["base"],"packages":{"bun":{"global":{"roles":{"work":[]}}}}}' \
  'packages.bun.global.roles contains unknown role "work"'
assert_render_failure non-list-role \
  '{"chezmoi":{"os":"linux"},"machineRoles":["base"],"packages":{"bun":{"global":{"roles":{"base":"prettier"}}}}}' \
  'packages.bun.global.roles.base must be a list'
assert_render_failure duplicate-within-role \
  '{"chezmoi":{"os":"linux"},"machineRoles":["base"],"packages":{"bun":{"global":{"roles":{"base":["shared","shared"]}}}}}' \
  'packages.bun.global.roles.base contains duplicate package "shared"'
assert_render_failure duplicate-ownership \
  '{"chezmoi":{"os":"linux"},"machineRoles":["base"],"packages":{"bun":{"global":{"roles":{"base":["shared"],"gaming":["shared"]}}}}}' \
  'bun global package "shared" belongs to both roles "base" and "gaming"'
assert_render_failure empty-identifier \
  '{"chezmoi":{"os":"linux"},"machineRoles":["base"],"packages":{"bun":{"global":{"roles":{"base":[""]}}}}}' \
  'packages.bun.global.roles.base[0] must be a non-empty string'
assert_render_failure whitespace-identifier \
  '{"chezmoi":{"os":"linux"},"machineRoles":["base"],"packages":{"bun":{"global":{"roles":{"base":[" prettier "]}}}}}' \
  'packages.bun.global.roles.base[0] must not have leading or trailing whitespace'

fake_bin="$test_root/fake-bin"
mkdir -p "$fake_bin"
for executable in curl wget; do
  printf '#!/bin/sh\necho "network forbidden in unit tests" >&2\nexit 97\n' >"$fake_bin/$executable"
  chmod +x "$fake_bin/$executable"
done

cat >"$fake_bin/bun" <<'FAKE_BUN'
#!/usr/bin/env bash
set -euo pipefail

case ":$PATH:" in
  *":$BUN_INSTALL/bin:"*) ;;
  *)
    echo "Bun global bin directory is missing from PATH" >&2
    exit 1
    ;;
esac

case "${1:-}" in
  -e)
    printf '%s\n' $BUN_CURRENT_PACKAGES
    ;;
  add)
    printf 'add' >>"$BUN_INVOCATION_LOG"
    shift
    printf '\t%s' "$@" >>"$BUN_INVOCATION_LOG"
    printf '\n' >>"$BUN_INVOCATION_LOG"
    mkdir -p "$BUN_INSTALL/bin"
    cat >"$BUN_INSTALL/bin/prettier" <<'PRETTIER'
#!/usr/bin/env bash
printf '%s\n' 3.9.6
PRETTIER
    chmod +x "$BUN_INSTALL/bin/prettier"
    ;;
  remove)
    printf 'remove' >>"$BUN_INVOCATION_LOG"
    shift
    printf '\t%s' "$@" >>"$BUN_INVOCATION_LOG"
    printf '\n' >>"$BUN_INVOCATION_LOG"
    ;;
  *)
    printf 'unexpected bun command: %s\n' "$*" >&2
    exit 1
    ;;
esac
FAKE_BUN
chmod +x "$fake_bin/bun"

run_reconciliation_case() {
  local rendered_script=$1
  local case_root=$2
  local current_packages=$3
  export BUN_INSTALL="$case_root/bun-home"
  export BUN_INVOCATION_LOG="$case_root/bun-invocation.log"
  export BUN_CURRENT_PACKAGES="$current_packages"
  mkdir -p "$BUN_INSTALL/install/global"
  cat >"$BUN_INSTALL/install/global/package.json" <<'JSON'
{"dependencies":{"hunkdiff":"latest","is-number":"latest","prettier":"latest"}}
JSON
  mkdir -p "$case_root/home" "$case_root/config"
  PATH="$fake_bin:/usr/bin:/bin" HOME="$case_root/home" XDG_CONFIG_HOME="$case_root/config" bash "$rendered_script"
}

run_reconciliation_case "$test_root/base.sh" "$test_root/declared-case" \
  'is-number prettier'
printf 'add\t--global\tprettier@latest\t@earendil-works/pi-coding-agent@latest\thunkdiff@latest\t@doist/todoist-cli@latest\nremove\t--global\tis-number\n' \
  >"$test_root/expected-declared-invocations.log"
diff -u \
  "$test_root/expected-declared-invocations.log" \
  "$test_root/declared-case/bun-invocation.log"
test -x "$test_root/declared-case/bun-home/bin/prettier"
PATH="$test_root/declared-case/bun-home/bin:$PATH" prettier --version >/dev/null

render_bun denied-hunkdiff '{"chezmoi":{"os":"linux"},"machineRoles":["base"],"packagePolicy":{"deniedPrefixes":["hunkdiff"]}}'
run_reconciliation_case "$test_root/denied-hunkdiff.sh" "$test_root/denied-case" \
  'hunkdiff is-number prettier'
printf 'add\t--global\tprettier@latest\t@earendil-works/pi-coding-agent@latest\t@doist/todoist-cli@latest\nremove\t--global\thunkdiff\tis-number\n' \
  >"$test_root/expected-denied-invocations.log"
diff -u \
  "$test_root/expected-denied-invocations.log" \
  "$test_root/denied-case/bun-invocation.log"

render_bun legacy-denied-hunkdiff '{"chezmoi":{"os":"linux"},"machineRoles":["base"],"blocked_prefixes":["hunkdiff"]}'
run_reconciliation_case "$test_root/legacy-denied-hunkdiff.sh" "$test_root/legacy-denied-case" \
  'hunkdiff is-number prettier'
printf 'add\t--global\tprettier@latest\t@earendil-works/pi-coding-agent@latest\t@doist/todoist-cli@latest\nremove\t--global\thunkdiff\tis-number\n' \
  >"$test_root/expected-legacy-denied-invocations.log"
diff -u \
  "$test_root/expected-legacy-denied-invocations.log" \
  "$test_root/legacy-denied-case/bun-invocation.log"

render_bun combined-denials '{"chezmoi":{"os":"linux"},"machineRoles":["base"],"packagePolicy":{"deniedPrefixes":["prettier","hunkdiff"]},"blocked_prefixes":["hunkdiff","@earendil-works/pi"]}'
run_reconciliation_case "$test_root/combined-denials.sh" "$test_root/combined-denial-case" \
  'hunkdiff is-number prettier'
printf 'add\t--global\t@doist/todoist-cli@latest\nremove\t--global\thunkdiff\tis-number\tprettier\n' \
  >"$test_root/expected-combined-denial-invocations.log"
diff -u \
  "$test_root/expected-combined-denial-invocations.log" \
  "$test_root/combined-denial-case/bun-invocation.log"
