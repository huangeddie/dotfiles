#!/usr/bin/env bash
set -euo pipefail

source_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
test_root=$(mktemp -d)
trap 'rm -rf "$test_root"' EXIT
empty_config="$test_root/empty-config.toml"
: >"$empty_config"
override='{"chezmoi":{"os":"linux"},"machineRoles":["base"]}'
projects=(grain todoist)

fail() {
  echo "$*" >&2
  exit 1
}

# Bun lockfile version 2 is unreadable before Bun 1.4, so every project with
# such a lockfile must declare that minimum in package.json engines.
for project in "${projects[@]}"; do
  python3 - "$source_dir/dot_config/$project" <<'PY'
import json
import pathlib
import re
import sys

project = pathlib.Path(sys.argv[1])
lockfile_version = int(re.search(r'"lockfileVersion":\s*(\d+)', (project / "bun.lock").read_text()).group(1))
engine = json.loads((project / "package.json").read_text())["engines"]["bun"]
minimum = {1: ">=1.2.0", 2: ">=1.4.0"}[lockfile_version]
if engine != minimum:
    raise AssertionError(f"{project.name}: lockfile v{lockfile_version} requires engines.bun {minimum!r}, got {engine!r}")
PY
done

# Runs a project's rendered dependency script against a fake Bun that reports
# $initial until `bun upgrade` switches it to $upgraded. Sets $case_root and
# $status; the fake records each upgrade/install call in $case_root/calls.
run_install() {
  local project=$1 initial=$2 upgraded=$3
  case_root="$test_root/$project-$initial-$upgraded"
  mkdir -p "$case_root/bun/bin"
  printf '%s\n' "$initial" >"$case_root/version"
  : >"$case_root/calls"
  cat >"$case_root/bun/bin/bun" <<SH
#!/bin/sh
case "\$1" in
  --version) cat "$case_root/version" ;;
  upgrade) echo upgrade >>"$case_root/calls"; printf '%s\n' "$upgraded" >"$case_root/version" ;;
  install) echo "install \$*" >>"$case_root/calls" ;;
  *) echo "unexpected bun \$*" >&2; exit 64 ;;
esac
SH
  chmod +x "$case_root/bun/bin/bun"
  chezmoi --config "$empty_config" --source "$source_dir" --override-data "$override" \
    execute-template -f "$source_dir/run_onchange_after_install-$project-dependencies.sh.tmpl" \
    >"$case_root/script.sh"
  status=0
  HOME="$case_root" BUN_INSTALL="$case_root/bun" sh "$case_root/script.sh" \
    >"$case_root/output" 2>&1 || status=$?
}

for project in "${projects[@]}"; do
  install_call="install install --cwd $test_root/$project-%s/.config/$project --frozen-lockfile"

  run_install "$project" 1.3.13 1.4.3
  expected=$(printf "upgrade\n$install_call" "1.3.13-1.4.3")
  [ "$status" -eq 0 ] || fail "$project: outdated Bun failed: $(cat "$case_root/output")"
  [ "$(cat "$case_root/calls")" = "$expected" ] ||
    fail "$project: outdated Bun was not upgraded before install: $(cat "$case_root/calls")"

  run_install "$project" 1.10.0 1.10.0
  expected=$(printf "$install_call" "1.10.0-1.10.0")
  [ "$status" -eq 0 ] || fail "$project: current Bun failed: $(cat "$case_root/output")"
  [ "$(cat "$case_root/calls")" = "$expected" ] ||
    fail "$project: current Bun was upgraded or not installed: $(cat "$case_root/calls")"

  run_install "$project" 1.3.13 1.3.13
  [ "$status" -ne 0 ] || fail "$project: unsatisfiable Bun did not fail"
  [ "$(cat "$case_root/calls")" = "upgrade" ] ||
    fail "$project: unsatisfiable Bun still installed: $(cat "$case_root/calls")"
  grep -Fq '>=1.4.0' "$case_root/output" ||
    fail "$project: unsatisfiable Bun error omits the required range: $(cat "$case_root/output")"
done
