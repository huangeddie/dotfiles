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

expected_linux_custom = [
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

if packages["darwin"]["custom"] != []:
    raise AssertionError(f'unexpected Darwin custom installers: {packages["darwin"]["custom"]!r}')
if packages["linux"]["custom"] != expected_linux_custom:
    raise AssertionError(f'unexpected Linux custom installers: {packages["linux"]["custom"]!r}')
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

install_commands = [
    "curl -fsSL https://alexpasmantier.github.io/television/install.sh | bash",
    "curl -sSfL https://raw.githubusercontent.com/ajeetdsouza/zoxide/main/install.sh | sh",
    "curl -fsSL https://herdr.dev/install.sh | sh",
    "curl -fsSL https://bun.com/install | bash",
]
positions = [script.index(command) for command in install_commands]
if positions != sorted(positions):
    raise AssertionError(f"custom installers rendered out of order: {positions!r}")
if any(script.count(command) != 1 for command in install_commands):
    raise AssertionError("a custom installer command was not rendered exactly once")

bun_install_position = positions[-1]
bun_check_position = script.rfind("if ! command -v", 0, bun_install_position)
bun_setup_position = script.index('export PATH="$BUN_INSTALL/bin:$PATH"')
if bun_check_position < 0 or bun_setup_position >= bun_check_position:
    raise AssertionError("Bun setup did not render before executable discovery")
PY

synthetic_template="$test_root/synthetic.tmpl"
cat >"$synthetic_template" <<'TMPL'
#!/usr/bin/env bash
set -euo pipefail
{{ template "install-custom-packages.sh.tmpl" (list
  (dict "name" "prepared tool" "executable" "prepared-tool" "setup" "export PATH=\"$SYNTHETIC_BIN:$PATH\"" "install" "echo unexpected >>\"$INSTALL_LOG\"")
  (dict "name" "missing tool" "executable" "chezmoi-test-missing-custom-tool" "install" "echo installed-missing >>\"$INSTALL_LOG\"")
  (dict "name" "failing tool" "executable" "chezmoi-test-failing-custom-tool" "install" "echo before-failure >>\"$INSTALL_LOG\"\nfalse")
  (dict "name" "later tool" "executable" "chezmoi-test-later-custom-tool" "install" "echo after-failure >>\"$INSTALL_LOG\"")
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
if SYNTHETIC_BIN="$synthetic_bin" \
  INSTALL_LOG="$install_log" \
  PATH="/usr/bin:/bin" \
  bash "$synthetic_script"; then
  echo "failed installer did not stop the generated script" >&2
  exit 1
fi
printf '%s\n' installed-missing before-failure \
  >"$test_root/expected-install.log"
diff -u "$test_root/expected-install.log" "$install_log"

metadata_template="$test_root/metadata.tmpl"
cat >"$metadata_template" <<'TMPL'
#!/usr/bin/env bash
set -euo pipefail
{{ template "install-custom-packages.sh.tmpl" (list
  (dict "name" "O'Reilly $(touch \"$METADATA_MARKER\")\ntouch \"$METADATA_MARKER\"" "executable" "chezmoi-test-metadata-tool" "install" ":")
) }}
TMPL
metadata_script="$test_root/metadata.sh"
chezmoi --source "$source_dir" execute-template \
  -f "$metadata_template" >"$metadata_script"
bash -n "$metadata_script"
metadata_marker="$test_root/metadata-expanded"
METADATA_MARKER="$metadata_marker" PATH="/usr/bin:/bin" \
  bash "$metadata_script" >/dev/null
if [[ -e "$metadata_marker" ]]; then
  echo "custom installer metadata was evaluated as shell" >&2
  exit 1
fi

assert_invalid() {
  local case_name=$1
  local expected_error=$2
  local template=$3
  local template_file="$test_root/$case_name.tmpl"

  printf '%s\n' "$template" >"$template_file"
  if chezmoi --source "$source_dir" execute-template \
    -f "$template_file" \
    >"$test_root/$case_name.out" \
    2>"$test_root/$case_name.err"; then
    echo "renderer accepted invalid custom installer case: $case_name" >&2
    exit 1
  fi
  grep -Fq "$expected_error" "$test_root/$case_name.err"
}

assert_invalid \
  non-map \
  'custom installer 0: entry must be a map' \
  '{{ template "install-custom-packages.sh.tmpl" (list "invalid") }}'
assert_invalid \
  missing-name \
  'custom installer 0: name must not be empty' \
  '{{ template "install-custom-packages.sh.tmpl" (list (dict "executable" "invalid" "install" ":")) }}'
assert_invalid \
  name-type \
  'custom installer 0: name must be a string' \
  '{{ template "install-custom-packages.sh.tmpl" (list (dict "name" true "executable" "invalid" "install" ":")) }}'
assert_invalid \
  executable-type \
  'custom installer 0: executable must be a string' \
  '{{ template "install-custom-packages.sh.tmpl" (list (dict "name" "invalid" "executable" true "install" ":")) }}'
assert_invalid \
  empty-executable \
  'custom installer 0: executable must not be empty' \
  '{{ template "install-custom-packages.sh.tmpl" (list (dict "name" "invalid" "executable" "   " "install" ":")) }}'
assert_invalid \
  unsafe-executable \
  'custom installer 0: executable must be a command name' \
  '{{ template "install-custom-packages.sh.tmpl" (list (dict "name" "invalid" "executable" "bad;command" "install" ":")) }}'
assert_invalid \
  setup-type \
  'custom installer 0: setup must be a string' \
  '{{ template "install-custom-packages.sh.tmpl" (list (dict "name" "invalid" "executable" "invalid" "setup" true "install" ":")) }}'
assert_invalid \
  install-type \
  'custom installer 0: install must be a string' \
  '{{ template "install-custom-packages.sh.tmpl" (list (dict "name" "invalid" "executable" "invalid" "install" true)) }}'
assert_invalid \
  missing-install \
  'custom installer 0: install must not be empty' \
  '{{ template "install-custom-packages.sh.tmpl" (list (dict "name" "invalid" "executable" "invalid")) }}'
