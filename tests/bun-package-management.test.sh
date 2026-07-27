#!/usr/bin/env bash
set -euo pipefail

source_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
test_root=$(mktemp -d)
trap 'rm -rf "$test_root"' EXIT

schema_json="$test_root/schema.json"
chezmoi --source "$source_dir" data --format json >"$schema_json"
python3 - "$schema_json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as stream:
    packages = json.load(stream)["packages"]

assert packages["bun"]["global"] == ["prettier", "@earendil-works/pi-coding-agent"]
assert "bun" in packages["darwin"]["brews"]
PY

linux_script="$test_root/linux-install-packages.sh"
chezmoi --source "$source_dir" execute-template \
  -f "$source_dir/run_onchange_before_linux-install-packages.sh.tmpl" \
  >"$linux_script"
grep -Fqx '  curl -fsSL https://bun.com/install | bash' "$linux_script"
grep -Fqx 'export PATH="$BUN_INSTALL/bin:$PATH"' "$linux_script"

sync_script="$test_root/sync-bun-global-packages.sh"
chezmoi --source "$source_dir" execute-template \
  -f "$source_dir/run_onchange_after_install-bun-global-packages.sh.tmpl" \
  >"$sync_script"
bash -n "$sync_script"

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
    printf '%s\n' is-number prettier
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
  export BUN_INSTALL="$case_root/bun-home"
  export BUN_INVOCATION_LOG="$case_root/bun-invocation.log"
  mkdir -p "$BUN_INSTALL/install/global"
  cat >"$BUN_INSTALL/install/global/package.json" <<'JSON'
{"dependencies":{"is-number":"latest","prettier":"latest"}}
JSON
  PATH="$fake_bin:/usr/bin:/bin" HOME="$case_root/home" bash "$rendered_script"
}

run_reconciliation_case "$sync_script" "$test_root/declared-case"
printf 'add\t--global\tprettier@latest\t@earendil-works/pi-coding-agent@latest\nremove\t--global\tis-number\n' \
  >"$test_root/expected-declared-invocations.log"
diff -u \
  "$test_root/expected-declared-invocations.log" \
  "$test_root/declared-case/bun-invocation.log"
test -x "$test_root/declared-case/bun-home/bin/prettier"
PATH="$test_root/declared-case/bun-home/bin:$PATH" prettier --version >/dev/null

empty_sync_script="$test_root/empty-sync-bun-global-packages.sh"
chezmoi --source "$source_dir" --override-data '{"packages":{"bun":{"global":[]}}}' \
  execute-template \
  -f "$source_dir/run_onchange_after_install-bun-global-packages.sh.tmpl" \
  >"$empty_sync_script"
bash -n "$empty_sync_script"
run_reconciliation_case "$empty_sync_script" "$test_root/empty-case"
printf 'remove\t--global\tis-number\tprettier\n' \
  >"$test_root/expected-empty-invocations.log"
diff -u \
  "$test_root/expected-empty-invocations.log" \
  "$test_root/empty-case/bun-invocation.log"
test ! -e "$test_root/empty-case/bun-home/bin/prettier"
