#!/usr/bin/env bash
set -euo pipefail

source_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT

base_darwin='{"chezmoi":{"os":"darwin"},"machineRoles":["base"]}'

schema_json="$test_dir/schema.json"
chezmoi --source "$source_dir" data --format json >"$schema_json"
python3 - "$schema_json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as stream:
    packages = json.load(stream)["packages"]

darwin = packages["darwin"]
assert darwin["taps"]["roles"]["base"] == ["modem-dev/tap"]
assert darwin["trusted_formulae"]["roles"]["base"] == ["modem-dev/tap/hunk"]
assert "git-delta" in darwin["brews"]["roles"]["base"]
assert darwin["casks"]["roles"]["base"] == [
    "codex",
    "font-jetbrains-mono-nerd-font",
    "gcloud-cli",
    "ghostty",
]
PY

render_darwin() {
  local name=$1
  local override=$2
  chezmoi --source "$source_dir" --override-data "$override" \
    execute-template \
    -f "$source_dir/run_onchange_before_darwin-install-packages.sh.tmpl" \
    >"$test_dir/$name.sh"
  bash -n "$test_dir/$name.sh"
}

render_darwin base "$base_darwin"

fake_bin="$test_dir/bin"
mkdir -p "$fake_bin"
cat >"$fake_bin/brew" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$BREW_CALLS"
if [[ ${1-} == bundle ]]; then
  cat >"$BREWFILE_INPUT"
fi
EOF
chmod +x "$fake_bin/brew"

brew_calls="$test_dir/brew-calls"
brewfile_input="$test_dir/Brewfile"
PATH="$fake_bin:$PATH" \
HOME="$test_dir/home" \
XDG_CONFIG_HOME="$test_dir/config" \
BREW_CALLS="$brew_calls" \
BREWFILE_INPUT="$brewfile_input" \
  bash "$test_dir/base.sh"

trust_call_count=$(grep -Fxc 'trust --formula modem-dev/tap/hunk' "$brew_calls" || true)
if [[ $trust_call_count -ne 2 ]]; then
  echo "rendered installer did not restore declared tap trust around bundle cleanup" >&2
  exit 1
fi

if ! grep -Fqx 'bundle install --file=/dev/stdin --force-cleanup' "$brew_calls"; then
  echo "rendered installer did not use strict brew bundle cleanup" >&2
  exit 1
fi

python3 - "$brewfile_input" <<'PY'
import sys

with open(sys.argv[1], encoding="utf-8") as stream:
    declarations = [line.rstrip("\n") for line in stream]

assert declarations == [
    'tap "modem-dev/tap"',
    'brew "gmp"',
    'brew "libyaml"',
    'brew "openssl@3"',
    'brew "bat"',
    'brew "bun"',
    'brew "chezmoi"',
    'brew "cloudflared"',
    'brew "fd"',
    'brew "ffmpeg"',
    'brew "fzf"',
    'brew "gh"',
    'brew "git-delta"',
    'brew "herdr"',
    'brew "jj"',
    'brew "jjui"',
    'brew "lazygit"',
    'brew "mise"',
    'brew "modem-dev/tap/hunk"',
    'brew "neovim"',
    'brew "python"',
    'brew "rust-analyzer"',
    'brew "stylua"',
    'brew "swiftformat"',
    'brew "television"',
    'brew "universal-ctags"',
    'brew "zig"',
    'brew "zoxide"',
    'cask "codex"',
    'cask "font-jetbrains-mono-nerd-font"',
    'cask "gcloud-cli"',
    'cask "ghostty"',
]
PY

if chezmoi --source "$source_dir" \
  --override-data '{"chezmoi":{"os":"darwin"},"machineRoles":["base","gaming"]}' \
  execute-template \
  -f "$source_dir/run_onchange_before_darwin-install-packages.sh.tmpl" \
  >"$test_dir/gaming.out" 2>"$test_dir/gaming.err"; then
  echo "Darwin renderer accepted the unsupported gaming role" >&2
  exit 1
fi
grep -Fq 'machine role "gaming" is not supported on darwin' "$test_dir/gaming.err"

render_darwin new-denial '{"chezmoi":{"os":"darwin"},"machineRoles":["base"],"packagePolicy":{"deniedPrefixes":["git-delta","codex"]}}'
if grep -Fqx 'brew "git-delta"' "$test_dir/new-denial.sh" ||
  grep -Fqx 'cask "codex"' "$test_dir/new-denial.sh"; then
  echo "new package-policy denials remained in the Brewfile" >&2
  exit 1
fi

render_darwin legacy-denial '{"chezmoi":{"os":"darwin"},"machineRoles":["base"],"blocked_prefixes":["git-delta","codex"]}'
if grep -Fqx 'brew "git-delta"' "$test_dir/legacy-denial.sh" ||
  grep -Fqx 'cask "codex"' "$test_dir/legacy-denial.sh"; then
  echo "legacy package-policy denials remained in the Brewfile" >&2
  exit 1
fi
