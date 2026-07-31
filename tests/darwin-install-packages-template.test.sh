#!/usr/bin/env bash
set -euo pipefail

source_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT

default_script="$test_dir/default.sh"
chezmoi --source "$source_dir" \
  --override-data '{"chezmoi":{"os":"darwin"}}' \
  execute-template \
  -f "$source_dir/run_onchange_before_darwin-install-packages.sh.tmpl" \
  >"$default_script"

if ! grep -Fqx 'cask "codex"' "$default_script"; then
  echo "rendered default brew bundle list omitted declared cask codex" >&2
  exit 1
fi

if ! grep -Fqx 'cask "font-jetbrains-mono-nerd-font"' "$default_script"; then
  echo "rendered default brew bundle list omitted declared cask font-jetbrains-mono-nerd-font" >&2
  exit 1
fi

if ! grep -Fqx 'cask "gcloud-cli"' "$default_script"; then
  echo "rendered default brew bundle list omitted declared cask gcloud-cli" >&2
  exit 1
fi

blocked_script="$test_dir/blocked.sh"
chezmoi --source "$source_dir" \
  --override-data '{"chezmoi":{"os":"darwin"},"blocked_prefixes":["codex","font-jetbrains-mono-nerd-font","gcloud-cli"]}' \
  execute-template \
  -f "$source_dir/run_onchange_before_darwin-install-packages.sh.tmpl" \
  >"$blocked_script"

if grep -Fqx 'cask "codex"' "$blocked_script"; then
  echo "rendered brew bundle list included blocked cask codex" >&2
  exit 1
fi

if grep -Fqx 'cask "font-jetbrains-mono-nerd-font"' "$blocked_script"; then
  echo "rendered brew bundle list included blocked cask font-jetbrains-mono-nerd-font" >&2
  exit 1
fi

if grep -Fqx 'cask "gcloud-cli"' "$blocked_script"; then
  echo "rendered brew bundle list included blocked cask gcloud-cli" >&2
  exit 1
fi

unblocked_script="$test_dir/unblocked.sh"
chezmoi --source "$source_dir" \
  --override-data '{"chezmoi":{"os":"darwin"},"blocked_prefixes":[]}' \
  execute-template \
  -f "$source_dir/run_onchange_before_darwin-install-packages.sh.tmpl" \
  >"$unblocked_script"

if ! grep -Fqx 'cask "codex"' "$unblocked_script"; then
  echo "rendered brew bundle list omitted unblocked cask codex" >&2
  exit 1
fi

if ! grep -Fqx 'brew "git-delta"' "$unblocked_script"; then
  echo "rendered brew bundle list omitted unblocked brew git-delta" >&2
  exit 1
fi
