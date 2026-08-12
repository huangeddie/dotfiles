#!/usr/bin/env bash
set -euo pipefail

source_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT
empty_config="$test_dir/empty-config.toml"
: >"$empty_config"

base_darwin='{"chezmoi":{"os":"darwin"},"machineRoles":["base"]}'

schema_json="$test_dir/schema.json"
chezmoi --config "$empty_config" --source "$source_dir" data --format json >"$schema_json"
python3 - "$schema_json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as stream:
    packages = json.load(stream)["packages"]

darwin = packages["darwin"]
assert darwin["taps"]["roles"]["base"] == ["modem-dev/tap"]
assert darwin["trusted_formulae"]["roles"]["base"] == ["modem-dev/tap/hunk"]
assert "git-delta" in darwin["brews"]["roles"]["base"]
assert darwin["casks"]["roles"]["base"] == [
    "codex",
    "font-jetbrains-mono-nerd-font",
    "gcloud-cli",
    "ghostty",
]
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

assert_string_category_validation() {
  local category=$1
  local identifier=$2

  assert_render_failure \
    "$category-unsupported-role" \
    "{\"chezmoi\":{\"os\":\"darwin\"},\"machineRoles\":[\"base\"],\"packages\":{\"darwin\":{\"$category\":{\"roles\":{\"work\":[]}}}}}" \
    "packages.darwin.$category.roles contains unsupported darwin role \"work\""
  assert_render_failure \
    "$category-non-list-role" \
    "{\"chezmoi\":{\"os\":\"darwin\"},\"machineRoles\":[\"base\"],\"packages\":{\"darwin\":{\"$category\":{\"roles\":{\"base\":\"$identifier\"}}}}}" \
    "packages.darwin.$category.roles.base must be a list"
  assert_render_failure \
    "$category-empty-identifier" \
    "{\"chezmoi\":{\"os\":\"darwin\"},\"machineRoles\":[\"base\"],\"packages\":{\"darwin\":{\"$category\":{\"roles\":{\"base\":[\"\"]}}}}}" \
    "packages.darwin.$category.roles.base[0] must be a non-empty string"
  assert_render_failure \
    "$category-duplicate-within-role" \
    "{\"chezmoi\":{\"os\":\"darwin\"},\"machineRoles\":[\"base\"],\"packages\":{\"darwin\":{\"$category\":{\"roles\":{\"base\":[\"shared\",\"shared\"]}}}}}" \
    "packages.darwin.$category.roles.base contains duplicate $identifier \"shared\""
}

render_darwin base "$base_darwin"

fake_bin="$test_dir/bin"
mkdir -p "$fake_bin"
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
PATH="$fake_bin:$PATH" \
HOME="$test_dir/home" \
XDG_CONFIG_HOME="$test_dir/config" \
BREW_CALLS="$brew_calls" \
BREWFILE_INPUT="$brewfile_input" \
  bash "$test_dir/base.sh"

trust_call_count=$(grep -Fxc 'trust --formula modem-dev/tap/hunk' "$brew_calls" || true)
if [[ $trust_call_count -ne 2 ]]; then
  echo "rendered installer did not restore declared tap trust around bundle cleanup" >&2
  exit 1
fi

if ! grep -Fqx 'bundle install --file=/dev/stdin --force-cleanup' "$brew_calls"; then
  echo "rendered installer did not use strict brew bundle cleanup" >&2
  exit 1
fi

python3 - "$brewfile_input" <<'PY'
import sys

with open(sys.argv[1], encoding="utf-8") as stream:
    declarations = [line.rstrip("\n") for line in stream]

assert declarations == [
    'tap "modem-dev/tap"',
    'brew "gmp"',
    'brew "libyaml"',
    'brew "openssl@3"',
    'brew "bat"',
    'brew "bun"',
    'brew "chezmoi"',
    'brew "cloudflared"',
    'brew "fd"',
    'brew "ffmpeg"',
    'brew "fzf"',
    'brew "gh"',
    'brew "git-delta"',
    'brew "herdr"',
    'brew "jj"',
    'brew "jjui"',
    'brew "lazygit"',
    'brew "mise"',
    'brew "modem-dev/tap/hunk"',
    'brew "neovim"',
    'brew "python"',
    'brew "rust-analyzer"',
    'brew "stylua"',
    'brew "swiftformat"',
    'brew "television"',
    'brew "universal-ctags"',
    'brew "zig"',
    'brew "zoxide"',
    'cask "codex"',
    'cask "font-jetbrains-mono-nerd-font"',
    'cask "gcloud-cli"',
    'cask "ghostty"',
]
PY

assert_render_failure \
  gaming-role \
  '{"chezmoi":{"os":"darwin"},"machineRoles":["base","gaming"]}' \
  'machine role "gaming" is not supported on darwin'

assert_string_category_validation taps tap
assert_string_category_validation trusted_formulae formula
assert_string_category_validation brews brew
assert_string_category_validation casks cask

assert_render_failure \
  custom-unsupported-role \
  '{"chezmoi":{"os":"darwin"},"machineRoles":["base"],"packages":{"darwin":{"custom":{"roles":{"work":[]}}}}}' \
  'packages.darwin.custom.roles contains unsupported darwin role "work"'
assert_render_failure \
  custom-non-list-role \
  '{"chezmoi":{"os":"darwin"},"machineRoles":["base"],"packages":{"darwin":{"custom":{"roles":{"base":"synthetic-installer"}}}}}' \
  'packages.darwin.custom.roles.base must be a list'
assert_render_failure \
  custom-malformed-record \
  '{"chezmoi":{"os":"darwin"},"machineRoles":["base"],"packages":{"darwin":{"custom":{"roles":{"base":[{"name":"synthetic-installer","install":"true"}]}}}}}' \
  'custom installer 0: executable must not be empty'
assert_render_failure \
  custom-empty-name \
  '{"chezmoi":{"os":"darwin"},"machineRoles":["base"],"packages":{"darwin":{"custom":{"roles":{"base":[{"name":"","executable":"synthetic-installer","install":"true"}]}}}}}' \
  'packages.darwin.custom.roles.base[0].name must be a non-empty string'
assert_render_failure \
  custom-duplicate-within-role \
  '{"chezmoi":{"os":"darwin"},"machineRoles":["base"],"packages":{"darwin":{"custom":{"roles":{"base":[{"name":"shared","executable":"shared-one","install":"true"},{"name":"shared","executable":"shared-two","install":"true"}]}}}}}' \
  'packages.darwin.custom.roles.base contains duplicate installer "shared"'

render_darwin denied-tap '{"chezmoi":{"os":"darwin"},"machineRoles":["base"],"packagePolicy":{"deniedPrefixes":["modem-dev/tap"]}}'
denied_tap_calls="$test_dir/denied-tap-calls"
denied_tap_brewfile="$test_dir/denied-tap-Brewfile"
PATH="$fake_bin:$PATH" \
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

render_darwin custom-denial '{"chezmoi":{"os":"darwin"},"machineRoles":["base"],"packagePolicy":{"deniedPrefixes":["synthetic-installer"]},"packages":{"darwin":{"custom":{"roles":{"base":[{"name":"synthetic-installer","executable":"synthetic-installer","install":"printf custom-denial-marker > \\u0022$CUSTOM_EFFECT\\u0022"}]}}}}}'
if grep -Fq 'custom-denial-marker' "$test_dir/custom-denial.sh"; then
  echo "denied custom installer command remained in the rendered script" >&2
  exit 1
fi
custom_effect="$test_dir/custom-effect"
PATH="$fake_bin:$PATH" \
HOME="$test_dir/home" \
XDG_CONFIG_HOME="$test_dir/config" \
BREW_CALLS="$test_dir/custom-denial-calls" \
BREWFILE_INPUT="$test_dir/custom-denial-Brewfile" \
CUSTOM_EFFECT="$custom_effect" \
  bash "$test_dir/custom-denial.sh"
if [[ -e $custom_effect ]]; then
  echo "denied custom installer command executed" >&2
  exit 1
fi

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
