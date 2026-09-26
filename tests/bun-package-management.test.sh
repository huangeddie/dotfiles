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
assert packages["pi-coding-agent"]["install"]["linux"]["bun"] == "@earendil-works/pi-coding-agent"
assert packages["todoist-cli"]["install"]["darwin"]["bun"] == "@doist/todoist-cli"
assert packages["bun"]["install"]["darwin"]["brew"] == "bun"
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

assert_render_failure shared-catalog-validation \
  '{"chezmoi":{"os":"linux"},"machineRoles":["base"],"packages":{"prettier":{"unexpected":true}}}' \
  'packages.prettier.unexpected'

execution_source="$test_root/execution-source"
mkdir -p "$execution_source"
cp -R "$source_dir/.chezmoitemplates" "$source_dir/.chezmoidata" "$execution_source/"
cp "$source_dir/run_onchange_after_install-bun-global-packages.sh.tmpl" "$execution_source/"
cat >"$execution_source/.chezmoidata/packages.yaml" <<'JSON'
{"machineRolePolicy":{"required":["base"],"platforms":{"linux":["base","gaming"],"darwin":["base"]}},"packages":{"prettier":{"role":"base","install":{"linux":{"bun":"prettier"}}},"hunkdiff":{"role":"base","install":{"linux":{"bun":"hunkdiff"}}}},"packageRemovals":{"linux":{"apt":[]}}}
JSON
render_execution() {
  local name=$1 override=$2
  chezmoi --config "$empty_config" --source "$execution_source" --override-data "$override" \
    execute-template -f "$execution_source/run_onchange_after_install-bun-global-packages.sh.tmpl" >"$test_root/$name.sh"
  bash -n "$test_root/$name.sh"
}
render_execution execution "$base_linux"

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

run_reconciliation_case "$test_root/execution.sh" "$test_root/declared-case" \
  'is-number prettier'
printf 'add\t--global\thunkdiff@latest\tprettier@latest\nremove\t--global\tis-number\n' \
  >"$test_root/expected-declared-invocations.log"
diff -u \
  "$test_root/expected-declared-invocations.log" \
  "$test_root/declared-case/bun-invocation.log"
test -x "$test_root/declared-case/bun-home/bin/prettier"
PATH="$test_root/declared-case/bun-home/bin:$PATH" prettier --version >/dev/null

render_execution denied-hunkdiff '{"chezmoi":{"os":"linux"},"machineRoles":["base"],"packagePolicy":{"deniedPrefixes":["hunkdiff"]}}'
run_reconciliation_case "$test_root/denied-hunkdiff.sh" "$test_root/denied-case" \
  'hunkdiff is-number prettier'
printf 'add\t--global\tprettier@latest\nremove\t--global\thunkdiff\tis-number\n' \
  >"$test_root/expected-denied-invocations.log"
diff -u \
  "$test_root/expected-denied-invocations.log" \
  "$test_root/denied-case/bun-invocation.log"

render_execution legacy-denied-hunkdiff '{"chezmoi":{"os":"linux"},"machineRoles":["base"],"blocked_prefixes":["hunkdiff"]}'
run_reconciliation_case "$test_root/legacy-denied-hunkdiff.sh" "$test_root/legacy-denied-case" \
  'hunkdiff is-number prettier'
printf 'add\t--global\tprettier@latest\nremove\t--global\thunkdiff\tis-number\n' \
  >"$test_root/expected-legacy-denied-invocations.log"
diff -u \
  "$test_root/expected-legacy-denied-invocations.log" \
  "$test_root/legacy-denied-case/bun-invocation.log"

render_execution combined-denials '{"chezmoi":{"os":"linux"},"machineRoles":["base"],"packagePolicy":{"deniedPrefixes":["prettier"]},"blocked_prefixes":["hunkdiff"]}'
run_reconciliation_case "$test_root/combined-denials.sh" "$test_root/combined-denial-case" \
  'hunkdiff is-number prettier'
printf 'remove\t--global\thunkdiff\tis-number\tprettier\n' \
  >"$test_root/expected-combined-denial-invocations.log"
diff -u "$test_root/expected-combined-denial-invocations.log" \
  "$test_root/combined-denial-case/bun-invocation.log"
