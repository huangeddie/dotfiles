#!/usr/bin/env bash
set -euo pipefail

source_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
test_root=$(mktemp -d)
trap 'rm -rf "$test_root"' EXIT
empty_config="$test_root/empty-config.toml"
: >"$empty_config"

render_validator() {
  local case_name=$1
  local override=$2
  local wrapper="$test_root/$case_name.tmpl"
  printf '%s\n' '{{ template "validate-machine-package-data.tmpl" . }}' >"$wrapper"
  chezmoi --config "$empty_config" --source "$source_dir" --override-data "$override" \
    execute-template -f "$wrapper"
}

assert_validation_failure() {
  local case_name=$1
  local override=$2
  local diagnostic=$3
  if render_validator "$case_name" "$override" \
    >"$test_root/$case_name.out" 2>"$test_root/$case_name.err"; then
    echo "accepted invalid machine package data: $case_name" >&2
    exit 1
  fi
  grep -Fq "$diagnostic" "$test_root/$case_name.err"
}

assert_direct_init_failure() {
  local case_name=$1
  local override=$2
  local diagnostic=$3
  if chezmoi --config "$empty_config" --source "$source_dir" --override-data "$override" \
    execute-template --init -f "$source_dir/.chezmoi.toml.tmpl" \
    >"$test_root/$case_name.out" 2>"$test_root/$case_name.err"; then
    echo "direct init accepted invalid machine package data: $case_name" >&2
    exit 1
  fi
  grep -Fq "$diagnostic" "$test_root/$case_name.err"
}

render_validator linux-base \
  '{"chezmoi":{"os":"linux"},"machineRoles":["base"]}' >/dev/null
render_validator linux-gaming \
  '{"chezmoi":{"os":"linux"},"machineRoles":["base","gaming"]}' >/dev/null
render_validator darwin-base \
  '{"chezmoi":{"os":"darwin"},"machineRoles":["base"]}' >/dev/null

assert_validation_failure missing-roles \
  '{"chezmoi":{"os":"linux"}}' \
  'machineRoles must be a non-empty list of roles'
assert_validation_failure empty-roles \
  '{"chezmoi":{"os":"linux"},"machineRoles":[]}' \
  'machineRoles must be a non-empty list of roles'
assert_validation_failure scalar-roles \
  '{"chezmoi":{"os":"linux"},"machineRoles":"base"}' \
  'machineRoles must be a non-empty list of roles'
assert_validation_failure non-string-role \
  '{"chezmoi":{"os":"linux"},"machineRoles":["base",42]}' \
  'machineRoles[1] must be a non-empty string'
assert_validation_failure duplicate-role \
  '{"chezmoi":{"os":"linux"},"machineRoles":["base","base"]}' \
  'machineRoles contains duplicate role "base"'
assert_validation_failure duplicate-non-base-role \
  '{"chezmoi":{"os":"linux"},"machineRoles":["base","gaming","gaming"]}' \
  'machineRoles contains duplicate role "gaming"'
assert_validation_failure unknown-role \
  '{"chezmoi":{"os":"linux"},"machineRoles":["base","work"]}' \
  'machine role "work" is not supported on linux'
assert_validation_failure missing-base \
  '{"chezmoi":{"os":"linux"},"machineRoles":["gaming"]}' \
  'machineRoles must include required role "base"'
assert_validation_failure darwin-gaming \
  '{"chezmoi":{"os":"darwin"},"machineRoles":["base","gaming"]}' \
  'machine role "gaming" is not supported on darwin'
assert_validation_failure empty-required-role-policy \
  '{"chezmoi":{"os":"linux"},"machineRoles":["base"],"machineRolePolicy":{"required":[]}}' \
  'machineRolePolicy.required must exactly equal ["base"]'
assert_validation_failure changed-required-role-policy \
  '{"chezmoi":{"os":"linux"},"machineRoles":["base"],"machineRolePolicy":{"required":["gaming"]}}' \
  'machineRolePolicy.required must exactly equal ["base"]'
assert_validation_failure malformed-required-role-policy \
  '{"chezmoi":{"os":"linux"},"machineRoles":["base"],"machineRolePolicy":{"required":"base"}}' \
  'machineRolePolicy.required must be a list'
assert_validation_failure darwin-gaming-policy \
  '{"chezmoi":{"os":"darwin"},"machineRoles":["base"],"machineRolePolicy":{"platforms":{"darwin":["base","gaming"]}}}' \
  'machineRolePolicy.platforms.darwin must exactly equal ["base"]'
assert_validation_failure linux-gaming-removed-policy \
  '{"chezmoi":{"os":"linux"},"machineRoles":["base"],"machineRolePolicy":{"platforms":{"linux":["base"]}}}' \
  'machineRolePolicy.platforms.linux must exactly equal ["base", "gaming"]'
assert_validation_failure linux-extra-role-policy \
  '{"chezmoi":{"os":"linux"},"machineRoles":["base"],"machineRolePolicy":{"platforms":{"linux":["base","gaming","work"]}}}' \
  'machineRolePolicy.platforms.linux must exactly equal ["base", "gaming"]'
assert_validation_failure malformed-linux-role-policy \
  '{"chezmoi":{"os":"linux"},"machineRoles":["base"],"machineRolePolicy":{"platforms":{"linux":"base"}}}' \
  'machineRolePolicy.platforms.linux must exactly equal ["base", "gaming"]'
assert_validation_failure extra-platform-policy \
  '{"chezmoi":{"os":"linux"},"machineRoles":["base"],"machineRolePolicy":{"platforms":{"windows":["base"]}}}' \
  'machineRolePolicy.platforms must contain exactly linux and darwin'
assert_validation_failure scalar-policy \
  '{"machineRoles":["base"],"packagePolicy":"deny"}' \
  'packagePolicy must be a map'
assert_validation_failure empty-scalar-policy \
  '{"machineRoles":["base"],"packagePolicy":""}' \
  'packagePolicy must be a map'
assert_validation_failure empty-new-prefix \
  '{"machineRoles":["base"],"packagePolicy":{"deniedPrefixes":[""]}}' \
  'packagePolicy.deniedPrefixes[0] must be a non-empty string'
assert_validation_failure non-string-new-prefix \
  '{"machineRoles":["base"],"packagePolicy":{"deniedPrefixes":[42]}}' \
  'packagePolicy.deniedPrefixes[0] must be a non-empty string'
assert_validation_failure empty-scalar-new-prefixes \
  '{"machineRoles":["base"],"packagePolicy":{"deniedPrefixes":""}}' \
  'packagePolicy.deniedPrefixes must be a list'
assert_validation_failure duplicate-new-prefix \
  '{"machineRoles":["base"],"packagePolicy":{"deniedPrefixes":["steam","steam"]}}' \
  'packagePolicy.deniedPrefixes contains duplicate prefix "steam"'
assert_validation_failure scalar-legacy-policy \
  '{"machineRoles":["base"],"blocked_prefixes":"steam"}' \
  'blocked_prefixes must be a list'
assert_validation_failure empty-legacy-prefix \
  '{"machineRoles":["base"],"blocked_prefixes":[""]}' \
  'blocked_prefixes[0] must be a non-empty string'
assert_validation_failure empty-scalar-legacy-prefixes \
  '{"machineRoles":["base"],"blocked_prefixes":""}' \
  'blocked_prefixes must be a list'
assert_validation_failure duplicate-legacy-prefix \
  '{"machineRoles":["base"],"blocked_prefixes":["steam","steam"]}' \
  'blocked_prefixes contains duplicate prefix "steam"'
assert_validation_failure non-string-legacy-prefix \
  '{"machineRoles":["base"],"blocked_prefixes":[42]}' \
  'blocked_prefixes[0] must be a non-empty string'

chezmoi --config "$empty_config" --source "$source_dir" \
  --override-data '{"chezmoi":{"os":"linux"}}' \
  execute-template --init \
  --promptBool 'Install gaming packages=true' \
  -f "$source_dir/.chezmoi.toml.tmpl" >"$test_root/linux-gaming.toml"

chezmoi --config "$empty_config" --source "$source_dir" \
  --override-data '{"chezmoi":{"os":"linux"}}' \
  execute-template --init \
  --promptBool 'Install gaming packages=false' \
  -f "$source_dir/.chezmoi.toml.tmpl" >"$test_root/linux-base.toml"

chezmoi --config "$empty_config" --source "$source_dir" \
  --override-data '{"chezmoi":{"os":"darwin"}}' \
  execute-template --init \
  -f "$source_dir/.chezmoi.toml.tmpl" >"$test_root/darwin-base.toml"

chezmoi --config "$empty_config" --source "$source_dir" \
  --override-data '{"chezmoi":{"os":"linux"},"machineRoles":["base","gaming"],"packagePolicy":{"deniedPrefixes":["steam","codex"]},"blocked_prefixes":["steam","tailscale"]}' \
  execute-template --init \
  -f "$source_dir/.chezmoi.toml.tmpl" >"$test_root/existing-data.toml"

assert_direct_init_failure direct-init-scalar-roles \
  '{"chezmoi":{"os":"linux"},"machineRoles":"base"}' \
  'machineRoles must be a non-empty list of roles'
assert_direct_init_failure direct-init-empty-roles \
  '{"chezmoi":{"os":"linux"},"machineRoles":[]}' \
  'machineRoles must be a non-empty list of roles'
assert_direct_init_failure direct-init-unsupported-roles \
  '{"chezmoi":{"os":"linux"},"machineRoles":["base","work"]}' \
  'machine role "work" is not supported on linux'
assert_direct_init_failure direct-init-empty-required-policy \
  '{"chezmoi":{"os":"linux"},"machineRolePolicy":{"required":[]}}' \
  'machineRolePolicy.required must exactly equal ["base"]'
assert_direct_init_failure direct-init-darwin-gaming-policy \
  '{"chezmoi":{"os":"darwin"},"machineRolePolicy":{"required":["base"],"platforms":{"linux":["base","gaming"],"darwin":["base","gaming"]}}}' \
  'machineRolePolicy.platforms.darwin must exactly equal ["base"]'

python3 - "$test_root" <<'PY'
import sys
import tomllib
from pathlib import Path

root = Path(sys.argv[1])
with (root / "linux-gaming.toml").open("rb") as stream:
    linux_gaming = tomllib.load(stream)
with (root / "linux-base.toml").open("rb") as stream:
    linux_base = tomllib.load(stream)
with (root / "darwin-base.toml").open("rb") as stream:
    darwin_base = tomllib.load(stream)
with (root / "existing-data.toml").open("rb") as stream:
    existing_data = tomllib.load(stream)

assert linux_gaming["data"]["machineRoles"] == ["base", "gaming"]
assert linux_base["data"]["machineRoles"] == ["base"]
assert darwin_base["data"]["machineRoles"] == ["base"]
for config in (linux_gaming, linux_base, darwin_base):
    assert config["data"]["packagePolicy"]["deniedPrefixes"] == []

assert existing_data["data"]["machineRoles"] == ["base", "gaming"]
assert existing_data["data"]["packagePolicy"]["deniedPrefixes"] == [
    "steam",
    "codex",
    "tailscale",
]
assert "blocked_prefixes" not in existing_data["data"]
PY
