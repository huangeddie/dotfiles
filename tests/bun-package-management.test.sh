#!/usr/bin/env bash
set -euo pipefail

source_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
test_root=$(mktemp -d)
trap 'rm -rf "$test_root"' EXIT

base_linux='{"machineRoles":["base"]}'

schema_json="$test_root/schema.json"
chezmoi --source "$source_dir" data --format json >"$schema_json"
python3 - "$schema_json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as stream:
    packages = json.load(stream)["packages"]

assert packages["bun"]["global"]["roles"]["base"] == [
    "prettier",
    "@earendil-works/pi-coding-agent",
    "hunkdiff",
]
assert "bun" in packages["darwin"]["brews"]["roles"]["base"]
PY

linux_script="$test_root/linux-install-packages.sh"
chezmoi --source "$source_dir" --override-data "$base_linux" \
  execute-template \
  -f "$source_dir/run_onchange_before_linux-install-packages.sh.tmpl" \
  >"$linux_script"
grep -Fqx '  curl -fsSL https://bun.com/install | bash' "$linux_script"
grep -Fqx 'export PATH="$BUN_INSTALL/bin:$PATH"' "$linux_script"

render_bun() {
  local name=$1
  local override=$2
  chezmoi --source "$source_dir" --override-data "$override" \
    execute-template \
    -f "$source_dir/run_onchange_after_install-bun-global-packages.sh.tmpl" \
    >"$test_root/$name.sh"
  bash -n "$test_root/$name.sh"
}

render_bun base "$base_linux"

fake_bin="$test_root/fake-bin"
mkdir -p "$fake_bin"
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
  PATH="$fake_bin:/usr/bin:/bin" HOME="$case_root/home" bash "$rendered_script"
}

run_reconciliation_case "$test_root/base.sh" "$test_root/declared-case" \
  'is-number prettier'
printf 'add\t--global\tprettier@latest\t@earendil-works/pi-coding-agent@latest\thunkdiff@latest\nremove\t--global\tis-number\n' \
  >"$test_root/expected-declared-invocations.log"
diff -u \
  "$test_root/expected-declared-invocations.log" \
  "$test_root/declared-case/bun-invocation.log"
test -x "$test_root/declared-case/bun-home/bin/prettier"
PATH="$test_root/declared-case/bun-home/bin:$PATH" prettier --version >/dev/null

render_bun denied-hunkdiff '{"machineRoles":["base"],"packagePolicy":{"deniedPrefixes":["hunkdiff"]}}'
run_reconciliation_case "$test_root/denied-hunkdiff.sh" "$test_root/denied-case" \
  'hunkdiff is-number prettier'
printf 'add\t--global\tprettier@latest\t@earendil-works/pi-coding-agent@latest\nremove\t--global\thunkdiff\tis-number\n' \
  >"$test_root/expected-denied-invocations.log"
diff -u \
  "$test_root/expected-denied-invocations.log" \
  "$test_root/denied-case/bun-invocation.log"
