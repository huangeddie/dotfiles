#!/usr/bin/env bash
set -euo pipefail

source_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT

default_script="$test_dir/default.sh"
chezmoi --source "$source_dir" \
  execute-template \
  -f "$source_dir/run_onchange_before_linux-install-packages.sh.tmpl" \
  >"$default_script"

if ! grep -Fqx '  "steam-installer"' "$default_script"; then
  echo "rendered default apt install list omitted package steam-installer" >&2
  exit 1
fi

blocked_script="$test_dir/blocked.sh"
chezmoi --source "$source_dir" \
  --override-data '{"blocked_prefixes":["steam-installer"]}' \
  execute-template \
  -f "$source_dir/run_onchange_before_linux-install-packages.sh.tmpl" \
  >"$blocked_script"

if grep -Fqx '  "steam-installer"' "$blocked_script"; then
  echo "rendered apt install list included blocked package steam-installer" >&2
  exit 1
fi

unblocked_script="$test_dir/unblocked.sh"
chezmoi --source "$source_dir" \
  --override-data '{"blocked_prefixes":[]}' \
  execute-template \
  -f "$source_dir/run_onchange_before_linux-install-packages.sh.tmpl" \
  >"$unblocked_script"

if ! grep -Fqx '  "steam-installer"' "$unblocked_script"; then
  echo "rendered apt install list omitted unblocked package steam-installer" >&2
  exit 1
fi

if ! grep -Fqx '  "golang-go"' "$unblocked_script"; then
  echo "rendered apt install list omitted unblocked package golang-go" >&2
  exit 1
fi
