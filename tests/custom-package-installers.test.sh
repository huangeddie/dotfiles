#!/usr/bin/env bash
set -euo pipefail

source_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
test_root=$(mktemp -d)
trap 'rm -rf "$test_root"' EXIT
empty_config="$test_root/empty-config.toml"
: >"$empty_config"

schema_json="$test_root/schema.json"
chezmoi --config "$empty_config" --source "$source_dir" data --format json >"$schema_json"
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
        "name": "tailscale",
        "executable": "tailscale",
        "install": "curl -fsSL https://tailscale.com/install.sh | sh",
    },
    {
        "name": "bun",
        "executable": "bun",
        "setup": 'export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"\n'
        'export PATH="$BUN_INSTALL/bin:$PATH"',
        "install": "curl -fsSL https://bun.com/install | bash",
    },
]

assert packages["darwin"]["custom"]["roles"]["base"] == []
assert packages["linux"]["custom"]["roles"]["base"] == expected_linux_custom
PY

render_linux() {
  local name=$1
  local override=$2
  chezmoi --config "$empty_config" --source "$source_dir" --override-data "$override" \
    execute-template \
    -f "$source_dir/run_onchange_before_linux-install-packages.sh.tmpl" \
    >"$test_root/$name.sh"
  bash -n "$test_root/$name.sh"
}

render_linux base '{"machineRoles":["base"]}'
python3 - "$test_root/base.sh" <<'PY'
import sys

with open(sys.argv[1], encoding="utf-8") as stream:
    script = stream.read()

install_commands = [
    "curl -fsSL https://alexpasmantier.github.io/television/install.sh | bash",
    "curl -sSfL https://raw.githubusercontent.com/ajeetdsouza/zoxide/main/install.sh | sh",
    "curl -fsSL https://herdr.dev/install.sh | sh",
    "curl -fsSL https://tailscale.com/install.sh | sh",
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

render_linux new-denial '{"machineRoles":["base"],"packagePolicy":{"deniedPrefixes":["tailscale"]}}'
if grep -Fq 'curl -fsSL https://tailscale.com/install.sh | sh' "$test_root/new-denial.sh"; then
  echo "new package-policy denial rendered a matching custom installer" >&2
  exit 1
fi

render_linux legacy-denial '{"machineRoles":["base"],"blocked_prefixes":["tailscale"]}'
if grep -Fq 'curl -fsSL https://tailscale.com/install.sh | sh' "$test_root/legacy-denial.sh"; then
  echo "legacy package-policy denial rendered a matching custom installer" >&2
  exit 1
fi

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
chezmoi --config "$empty_config" --source "$source_dir" execute-template \
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
chezmoi --config "$empty_config" --source "$source_dir" execute-template \
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
  if chezmoi --config "$empty_config" --source "$source_dir" execute-template \
    -f "$template_file" \
    >"$test_root/$case_name.out" \
    2>"$test_root/$case_name.err"; then
    echo "renderer accepted invalid custom installer case: $case_name" >&2
    exit 1
  fi
  grep -Fq "$expected_error" "$test_root/$case_name.err"
}

assert_invalid \
  map-container \
  'custom installers: declaration must be a list' \
  '{{ template "install-custom-packages.sh.tmpl" (dict "invalid" (dict "name" "invalid" "executable" "invalid" "install" ":")) }}'
assert_invalid \
  null-container \
  'custom installers: declaration must be a list' \
  '{{ template "install-custom-packages.sh.tmpl" ("null" | fromJson) }}'
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

blocked_test_template="$test_root/blocked.tmpl"
cat >"$blocked_test_template" <<'TMPL'
#!/usr/bin/env bash
set -euo pipefail
{{ template "install-custom-packages.sh.tmpl" (dict
  "custom" (list
    (dict "name" "tailscale" "executable" "tailscale" "install" "echo tailscale-install >>\"$INSTALL_LOG\"")
    (dict "name" "allowed tool" "executable" "chezmoi-test-allowed-tool" "install" "echo allowed-install >>\"$INSTALL_LOG\"")
  )
  "denied_prefixes" (list "tailscale")
) }}
TMPL
blocked_test_script="$test_root/blocked.sh"
chezmoi --config "$empty_config" --source "$source_dir" execute-template \
  -f "$blocked_test_template" >"$blocked_test_script"
bash -n "$blocked_test_script"

if grep -Fq 'echo tailscale-install' "$blocked_test_script"; then
  echo "denied custom installer was rendered" >&2
  exit 1
fi
if ! grep -Fq 'echo allowed-install' "$blocked_test_script"; then
  echo "allowed custom installer was not rendered" >&2
  exit 1
fi

legacy_map_template="$test_root/legacy-map.tmpl"
cat >"$legacy_map_template" <<'TMPL'
#!/usr/bin/env bash
set -euo pipefail
{{ template "install-custom-packages.sh.tmpl" (dict
  "custom" (list
    (dict "name" "new-denied" "executable" "chezmoi-test-new-denied" "install" "echo new-denied >>\"$INSTALL_LOG\"")
    (dict "name" "legacy-denied" "executable" "chezmoi-test-legacy-denied" "install" "echo legacy-denied >>\"$INSTALL_LOG\"")
    (dict "name" "shared-denied" "executable" "chezmoi-test-shared-denied" "install" "echo shared-denied >>\"$INSTALL_LOG\"")
    (dict "name" "allowed" "executable" "chezmoi-test-allowed" "install" "echo allowed >>\"$INSTALL_LOG\"")
  )
  "denied_prefixes" (list "new-denied" "shared-denied")
  "blocked_prefixes" (list "legacy-denied" "shared-denied")
) }}
TMPL
legacy_map_script="$test_root/legacy-map.sh"
chezmoi --config "$empty_config" --source "$source_dir" execute-template \
  -f "$legacy_map_template" >"$legacy_map_script"
bash -n "$legacy_map_script"
if grep -Fq 'echo new-denied' "$legacy_map_script" ||
  grep -Fq 'echo legacy-denied' "$legacy_map_script" ||
  grep -Fq 'echo shared-denied' "$legacy_map_script"; then
  echo "custom installer map denial union rendered a denied installer" >&2
  exit 1
fi
if [[ $(grep -Fxc "echo '🚫 Skipping shared-denied (denied prefix)'" "$legacy_map_script") -ne 1 ]]; then
  echo "custom installer map denial union did not deduplicate legacy denial" >&2
  exit 1
fi
if ! grep -Fq 'echo allowed' "$legacy_map_script"; then
  echo "custom installer map denial union suppressed an allowed installer" >&2
  exit 1
fi
