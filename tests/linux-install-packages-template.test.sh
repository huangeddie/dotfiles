#!/usr/bin/env bash
set -euo pipefail

source_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
rendered_script=$(mktemp)
trap 'rm -f "$rendered_script"' EXIT

chezmoi --source "$source_dir" execute-template \
  -f "$source_dir/run_onchange_before_linux-install-packages.sh.tmpl" \
  >"$rendered_script"

if ! grep -Fqx '  "steam-installer"' "$rendered_script"; then
  echo "rendered apt install list omitted declared package steam-installer" >&2
  exit 1
fi
