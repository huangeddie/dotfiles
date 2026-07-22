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

assert packages["darwin"]["custom"] == []
assert packages["linux"]["custom"] == [
    {
        "name": "television",
        "executable": "tv",
        "install": "curl -fsSL https://alexpasmantier.github.io/television/install.sh | bash",
    },
    {
        "name": "zoxide",
        "executable": "zoxide",
        "install": "curl -sSfL https://raw.githubusercontent.com/ajeetdsouza/zoxide/main/install.sh | sh",
    },
    {
        "name": "herdr",
        "executable": "herdr",
        "install": "curl -fsSL https://herdr.dev/install.sh | sh",
    },
    {
        "name": "bun",
        "executable": "bun",
        "setup": 'export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"\n'
        'export PATH="$BUN_INSTALL/bin:$PATH"',
        "install": "curl -fsSL https://bun.com/install | bash",
    },
]
PY

shared_template_call='{{ template "install-custom-packages.sh.tmpl" .packages.%s.custom }}'
printf -v linux_template_call "$shared_template_call" linux
printf -v darwin_template_call "$shared_template_call" darwin

grep -Fq "$linux_template_call" \
  "$source_dir/run_onchange_before_linux-install-packages.sh.tmpl" || {
  echo "Linux package script does not render packages.linux.custom" >&2
  exit 1
}
grep -Fq "$darwin_template_call" \
  "$source_dir/run_onchange_before_darwin-install-packages.sh.tmpl" || {
  echo "Darwin package script does not render packages.darwin.custom" >&2
  exit 1
}

if grep -Fq 'https://alexpasmantier.github.io/television/install.sh' \
  "$source_dir/run_onchange_before_linux-install-packages.sh.tmpl"; then
  echo "Linux package script still contains inline custom installers" >&2
  exit 1
fi

linux_script="$test_root/linux-install-packages.sh"
chezmoi --source "$source_dir" execute-template \
  -f "$source_dir/run_onchange_before_linux-install-packages.sh.tmpl" \
  >"$linux_script"
bash -n "$linux_script"
python3 - "$linux_script" <<'PY'
import sys

with open(sys.argv[1], encoding="utf-8") as stream:
    script = stream.read()

markers = ["# television", "# zoxide", "# herdr", "# bun"]
positions = [script.index(marker) for marker in markers]
assert positions == sorted(positions)
assert all(script.count(marker) == 1 for marker in markers)
assert script.index('export PATH="$BUN_INSTALL/bin:$PATH"') < script.index(
    'command -v "bun"'
)
PY

synthetic_template="$test_root/synthetic.tmpl"
cat >"$synthetic_template" <<'TMPL'
#!/usr/bin/env bash
set -euo pipefail
{{ template "install-custom-packages.sh.tmpl" (list
  (dict "name" "prepared tool" "executable" "prepared-tool" "setup" "export PATH=\"$SYNTHETIC_BIN:$PATH\"" "install" "echo unexpected >>\"$INSTALL_LOG\"")
  (dict "name" "missing tool" "executable" "chezmoi-test-missing-custom-tool" "install" "echo installed-missing >>\"$INSTALL_LOG\"")
) }}
TMPL

synthetic_script="$test_root/synthetic.sh"
chezmoi --source "$source_dir" execute-template \
  -f "$synthetic_template" >"$synthetic_script"
bash -n "$synthetic_script"

synthetic_bin="$test_root/synthetic-bin"
mkdir -p "$synthetic_bin"
cat >"$synthetic_bin/prepared-tool" <<'SH'
#!/usr/bin/env sh
exit 0
SH
chmod +x "$synthetic_bin/prepared-tool"

install_log="$test_root/install.log"
: >"$install_log"
SYNTHETIC_BIN="$synthetic_bin" \
  INSTALL_LOG="$install_log" \
  PATH="/usr/bin:/bin" \
  bash "$synthetic_script"
printf '%s\n' installed-missing >"$test_root/expected-install.log"
diff -u "$test_root/expected-install.log" "$install_log"

invalid_template="$test_root/invalid.tmpl"
cat >"$invalid_template" <<'TMPL'
{{ template "install-custom-packages.sh.tmpl" (list (dict "name" "invalid" "executable" "invalid")) }}
TMPL
if chezmoi --source "$source_dir" execute-template \
  -f "$invalid_template" >"$test_root/invalid.out" 2>"$test_root/invalid.err"; then
  echo "renderer accepted a custom installer without install" >&2
  exit 1
fi
grep -Fq 'custom installer 0: install must not be empty' \
  "$test_root/invalid.err"
