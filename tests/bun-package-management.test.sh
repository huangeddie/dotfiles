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

assert packages["bun"]["global"] == ["prettier"]
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
printf '%s\n' "$@" >"$BUN_INVOCATION_LOG"
FAKE_BUN
chmod +x "$fake_bin/bun"

export BUN_INSTALL="$test_root/bun-home"
export BUN_INVOCATION_LOG="$test_root/bun-invocation.log"
PATH="$fake_bin:$PATH" HOME="$test_root/home" bash "$sync_script"

cat >"$test_root/expected-package.json" <<'JSON'
{
  "dependencies": {
    "prettier": "latest"
  }
}
JSON

diff -u \
  "$test_root/expected-package.json" \
  "$BUN_INSTALL/install/global/package.json"

cat >"$test_root/expected-invocation.log" <<EOF
install
--cwd
$BUN_INSTALL/install/global
EOF

diff -u "$test_root/expected-invocation.log" "$BUN_INVOCATION_LOG"
