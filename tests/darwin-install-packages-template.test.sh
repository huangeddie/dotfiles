#!/usr/bin/env bash
set -euo pipefail

source_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT
empty_config="$test_dir/empty-config.toml"
: >"$empty_config"

base_darwin='{"chezmoi":{"os":"darwin"},"machineRoles":["base"]}'
execution_darwin="$base_darwin"

schema_json="$test_dir/schema.json"
chezmoi --config "$empty_config" --source "$source_dir" data --format json >"$schema_json"
python3 - "$schema_json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as stream:
    packages = json.load(stream)["packages"]

assert packages["hunk"]["install"]["darwin"]["trusted"] is True
assert packages["opencode"]["install"]["darwin"]["trusted"] is True
assert packages["git-delta"]["install"]["darwin"]["brew"] == "git-delta"
assert packages["ghostty"]["install"]["darwin"]["cask"] == "ghostty"
PY

render_darwin() {
  local name=$1
  local override=$2
  chezmoi --config "$empty_config" --source "$source_dir" --override-data "$override" \
    execute-template \
    -f "$source_dir/run_onchange_before_darwin-install-packages.sh.tmpl" \
    >"$test_dir/$name.sh"
  bash -n "$test_dir/$name.sh"
}

assert_render_failure() {
  local name=$1
  local override=$2
  local expected_error=$3

  if chezmoi --config "$empty_config" --source "$source_dir" --override-data "$override" \
    execute-template \
    -f "$source_dir/run_onchange_before_darwin-install-packages.sh.tmpl" \
    >"$test_dir/$name.out" 2>"$test_dir/$name.err"; then
    echo "Darwin renderer accepted invalid declaration: $name" >&2
    exit 1
  fi
  grep -Fq "$expected_error" "$test_dir/$name.err"
}

# Render executable cases from an isolated copy, never from the production source.
execution_source="$test_dir/execution-source"
mkdir -p "$execution_source"
cp -R "$source_dir/.chezmoitemplates" "$source_dir/.chezmoidata" "$execution_source/"
cp "$source_dir/run_onchange_before_darwin-install-packages.sh.tmpl" "$execution_source/"
cat >"$execution_source/.chezmoidata/packages.yaml" <<'JSON'
{"machineRolePolicy":{"required":["base"],"platforms":{"linux":["base","gaming"],"darwin":["base"]}},"packages":{"hunk":{"role":"base","install":{"darwin":{"brew":"modem-dev/tap/hunk","trusted":true}}},"opencode":{"role":"base","install":{"darwin":{"brew":"anomalyco/tap/opencode","trusted":true}}},"ghostty":{"role":"base","install":{"darwin":{"cask":"ghostty"}}}},"packageRemovals":{"linux":{"apt":[]}}}
JSON
render_execution() {
  local name=$1 override=$2
  chezmoi --config "$empty_config" --source "$execution_source" --override-data "$override" \
    execute-template -f "$execution_source/run_onchange_before_darwin-install-packages.sh.tmpl" >"$test_dir/$name.sh"
  bash -n "$test_dir/$name.sh"
  if grep -Eq 'sh\.rustup\.rs|claude\.ai/install\.sh|chatgpt\.com/codex/install\.sh' "$test_dir/$name.sh"; then
    echo "production custom installer in execution script" >&2; exit 1
  fi
}

render_darwin base "$base_darwin"
python3 - "$test_dir/base.sh" "$source_dir/tests/fixtures/packages/baseline.json" <<'PY'
import json, sys
script = open(sys.argv[1], encoding='utf-8').read()
records = json.load(open(sys.argv[2], encoding='utf-8'))['darwin-base']['custom']
positions = [script.index(record['install']) for record in records]
assert positions == sorted(positions), positions
assert all(script.count(record['install']) == 1 for record in records)
PY
render_execution execution "$execution_darwin"
# The consumer must call shared validation, including for unselected recipes.
assert_render_failure invalid-catalog '{"chezmoi":{"os":"darwin"},"machineRoles":["base"],"packages":{"ghostty":{"unexpected":true}}}' 'packages.ghostty.unexpected'

fake_bin="$test_dir/bin"
mkdir -p "$fake_bin" "$test_dir/home" "$test_dir/config"
for executable in curl wget; do
  printf '#!/bin/sh\necho "network forbidden in unit tests" >&2\nexit 97\n' >"$fake_bin/$executable"
  chmod +x "$fake_bin/$executable"
done
cat >"$fake_bin/brew" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$BREW_CALLS"
if [[ ${1-} == bundle ]]; then
  cat >"$BREWFILE_INPUT"
fi
EOF
chmod +x "$fake_bin/brew"

brew_calls="$test_dir/brew-calls"
brewfile_input="$test_dir/Brewfile"
PATH="$fake_bin:/usr/bin:/bin" \
HOME="$test_dir/home" \
XDG_CONFIG_HOME="$test_dir/config" \
BREW_CALLS="$brew_calls" \
BREWFILE_INPUT="$brewfile_input" \
  bash "$test_dir/execution.sh"

for formula in modem-dev/tap/hunk anomalyco/tap/opencode; do
  trust_call_count=$(grep -Fxc "trust --formula $formula" "$brew_calls" || true)
  if [[ $trust_call_count -ne 2 ]]; then
    echo "rendered installer did not restore trust for $formula around bundle cleanup" >&2
    exit 1
  fi
done

if ! grep -Fqx 'bundle install --file=/dev/stdin --force-cleanup' "$brew_calls"; then
  echo "rendered installer did not use strict brew bundle cleanup" >&2
  exit 1
fi

python3 - "$brewfile_input" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as stream:
    declarations = [line.rstrip("\n") for line in stream]
assert sorted(declarations) == sorted(['brew "modem-dev/tap/hunk"', 'brew "anomalyco/tap/opencode"', 'cask "ghostty"'])
PY

assert_render_failure \
  gaming-role \
  '{"chezmoi":{"os":"darwin"},"machineRoles":["base","gaming"]}' \
  'machine role "gaming" is not supported on darwin'

render_execution denied-tap '{"chezmoi":{"os":"darwin"},"machineRoles":["base"],"packagePolicy":{"deniedPrefixes":["modem-dev/tap"]}}'
denied_tap_calls="$test_dir/denied-tap-calls"
denied_tap_brewfile="$test_dir/denied-tap-Brewfile"
PATH="$fake_bin:/usr/bin:/bin" \
HOME="$test_dir/home" \
XDG_CONFIG_HOME="$test_dir/config" \
BREW_CALLS="$denied_tap_calls" \
BREWFILE_INPUT="$denied_tap_brewfile" \
  bash "$test_dir/denied-tap.sh"
if grep -Fq 'trust --formula modem-dev/tap/hunk' "$denied_tap_calls"; then
  echo "denied tap formula was still granted trust" >&2
  exit 1
fi
python3 - "$denied_tap_brewfile" <<'PY'
import sys

with open(sys.argv[1], encoding="utf-8") as stream:
    declarations = {line.rstrip("\n") for line in stream}

for declaration in [
    'tap "modem-dev/tap"',
    'brew "modem-dev/tap/hunk"',
]:
    assert declaration not in declarations, declaration
PY

render_darwin new-denial '{"chezmoi":{"os":"darwin"},"machineRoles":["base"],"packagePolicy":{"deniedPrefixes":["git-delta","codex"]}}'
if grep -Fqx 'brew "git-delta"' "$test_dir/new-denial.sh" ||
  grep -Fqx 'cask "codex"' "$test_dir/new-denial.sh"; then
  echo "new package-policy denials remained in the Brewfile" >&2
  exit 1
fi

render_darwin legacy-denial '{"chezmoi":{"os":"darwin"},"machineRoles":["base"],"blocked_prefixes":["git-delta","codex"]}'
if grep -Fqx 'brew "git-delta"' "$test_dir/legacy-denial.sh" ||
  grep -Fqx 'cask "codex"' "$test_dir/legacy-denial.sh"; then
  echo "legacy package-policy denials remained in the Brewfile" >&2
  exit 1
fi
