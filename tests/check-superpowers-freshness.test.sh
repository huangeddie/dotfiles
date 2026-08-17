#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd "$script_dir/.." && pwd)
target_script="$repo_root/dot_local/bin/executable_check-superpowers-freshness"

test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT

fake_bin="$test_dir/fake_bin"
mkdir -p "$fake_bin"

# Create fake git
cat >"$fake_bin/git" <<'EOF'
#!/bin/bash
if [[ "$1" == "clone" ]]; then
  target_clone="${@: -1}"
  mkdir -p "$target_clone/skills/test-skill"
  echo "name: test-skill" > "$target_clone/skills/test-skill/SKILL.md"
  exit 0
fi
if [[ "$1" == "-C" && "$3" == "rev-parse" ]]; then
  echo "0123456789abcdef0123456789abcdef01234567"
  exit 0
fi
exec /usr/bin/git "$@"
EOF
chmod +x "$fake_bin/git"

test_work_config_resolution() {
  local home="$test_dir/home_work"
  local src="$test_dir/src_work"
  mkdir -p "$home/.agents/packages/superpowers/skills/test-skill"
  echo "name: test-skill" > "$home/.agents/packages/superpowers/skills/test-skill/SKILL.md"
  mkdir -p "$src/_personal"
  cat >"$src/_personal/.chezmoiexternal.toml" <<'EOF'
[".agents/packages/superpowers/skills"]
    type = "archive"
    url = "https://github.com/huangeddie/superpowers/archive/refs/heads/main.tar.gz"
    exact = true
    refreshPeriod = "168h"
    stripComponents = 2
    include = ["*/skills/**"]
EOF

  local output
  output=$(PATH="$fake_bin:$PATH" CHEZMOI_SOURCE_DIR="$src" CHEZMOI_HOME_DIR="$home" bash "$target_script")
  if [[ "$output" != *"✓ superpowers skills are up to date with huangeddie/superpowers@main (0123456)"* ]]; then
    echo "Expected success output on work config, got: $output" >&2
    return 1
  fi
}

test_deeply_nested_config_resolution() {
  local home="$test_dir/home_nested"
  local src="$test_dir/src_nested"
  mkdir -p "$home/.agents/packages/superpowers/skills/test-skill"
  echo "name: test-skill" > "$home/.agents/packages/superpowers/skills/test-skill/SKILL.md"
  mkdir -p "$src/some/deeply/nested/directory"
  cat >"$src/some/deeply/nested/directory/.chezmoiexternal.toml" <<'EOF'
[".agents/packages/superpowers/skills"]
    type = "archive"
    url = "https://github.com/huangeddie/superpowers/archive/refs/heads/main.tar.gz"
    exact = true
    refreshPeriod = "168h"
    stripComponents = 2
    include = ["*/skills/**"]
EOF

  local output
  output=$(PATH="$fake_bin:$PATH" CHEZMOI_SOURCE_DIR="$src" CHEZMOI_HOME_DIR="$home" bash "$target_script")
  if [[ "$output" != *"✓ superpowers skills are up to date with huangeddie/superpowers@main (0123456)"* ]]; then
    echo "Expected success output on deeply nested config, got: $output" >&2
    return 1
  fi
}

test_git_dir_pruned() {
  local home="$test_dir/home_git_prune"
  local src="$test_dir/src_git_prune"
  mkdir -p "$home/.agents/packages/superpowers/skills/test-skill"
  echo "name: test-skill" > "$home/.agents/packages/superpowers/skills/test-skill/SKILL.md"
  mkdir -p "$src/.git"
  cat >"$src/.git/.chezmoiexternal.toml" <<'EOF'
[".agents/packages/superpowers/skills"]
    type = "archive"
    url = "https://github.com/huangeddie/superpowers/archive/refs/heads/main.tar.gz"
    exact = true
    refreshPeriod = "168h"
    stripComponents = 2
    include = ["*/skills/**"]
EOF

  local err_output
  set +e
  err_output=$(PATH="$fake_bin:$PATH" CHEZMOI_SOURCE_DIR="$src" CHEZMOI_HOME_DIR="$home" bash "$target_script" 2>&1)
  local status=$?
  set -e

  if [[ $status -eq 0 ]]; then
    echo "Expected failure when .chezmoiexternal.toml is only inside .git" >&2
    return 1
  fi
}

test_personal_config_resolution() {
  local home="$test_dir/home_personal"
  local src="$test_dir/src_personal"
  mkdir -p "$home/.agents/packages/superpowers/skills/test-skill"
  echo "name: test-skill" > "$home/.agents/packages/superpowers/skills/test-skill/SKILL.md"
  mkdir -p "$src"
  cat >"$src/.chezmoiexternal.toml" <<'EOF'
[".agents/packages/superpowers/skills"]
    type = "archive"
    url = "https://github.com/huangeddie/superpowers/archive/refs/heads/main.tar.gz"
    exact = true
    refreshPeriod = "168h"
    stripComponents = 2
    include = ["*/skills/**"]
EOF

  local output
  output=$(PATH="$fake_bin:$PATH" CHEZMOI_SOURCE_DIR="$src" CHEZMOI_HOME_DIR="$home" bash "$target_script")
  if [[ "$output" != *"✓ superpowers skills are up to date with huangeddie/superpowers@main (0123456)"* ]]; then
    echo "Expected success output on personal config, got: $output" >&2
    return 1
  fi
}

test_missing_external_file() {
  local home="$test_dir/home_missing"
  local src="$test_dir/src_missing"
  mkdir -p "$home" "$src"

  local err_output
  set +e
  err_output=$(PATH="$fake_bin:$PATH" CHEZMOI_SOURCE_DIR="$src" CHEZMOI_HOME_DIR="$home" bash "$target_script" 2>&1)
  local status=$?
  set -e

  if [[ $status -eq 0 ]]; then
    echo "Expected non-zero exit when external toml is missing" >&2
    return 1
  fi
  if [[ "$err_output" != *"Could not find url for [\".agents/packages/superpowers/skills\"]"* ]]; then
    echo "Expected descriptive missing error message, got: $err_output" >&2
    return 1
  fi
}

test_stale_detection() {
  local home="$test_dir/home_stale"
  local src="$test_dir/src_stale"
  mkdir -p "$home/.agents/packages/superpowers/skills/test-skill"
  echo "name: old-test-skill" > "$home/.agents/packages/superpowers/skills/test-skill/SKILL.md"
  mkdir -p "$src/_personal"
  cat >"$src/_personal/.chezmoiexternal.toml" <<'EOF'
[".agents/packages/superpowers/skills"]
    type = "archive"
    url = "https://github.com/huangeddie/superpowers/archive/refs/heads/main.tar.gz"
    exact = true
    refreshPeriod = "168h"
    stripComponents = 2
    include = ["*/skills/**"]
EOF

  local err_output
  set +e
  err_output=$(PATH="$fake_bin:$PATH" CHEZMOI_SOURCE_DIR="$src" CHEZMOI_HOME_DIR="$home" bash "$target_script" 2>&1)
  local status=$?
  set -e

  if [[ $status -eq 0 ]]; then
    echo "Expected non-zero exit when skills are stale" >&2
    return 1
  fi
  if [[ "$err_output" != *"✗ superpowers skills are stale against huangeddie/superpowers@main (0123456)"* ]]; then
    echo "Expected stale error message, got: $err_output" >&2
    return 1
  fi
}

test_missing_target_dir() {
  local home="$test_dir/home_notarget"
  local src="$test_dir/src_notarget"
  mkdir -p "$home" "$src/_personal"
  cat >"$src/_personal/.chezmoiexternal.toml" <<'EOF'
[".agents/packages/superpowers/skills"]
    type = "archive"
    url = "https://github.com/huangeddie/superpowers/archive/refs/heads/main.tar.gz"
    exact = true
    refreshPeriod = "168h"
    stripComponents = 2
    include = ["*/skills/**"]
EOF

  local err_output
  set +e
  err_output=$(PATH="$fake_bin:$PATH" CHEZMOI_SOURCE_DIR="$src" CHEZMOI_HOME_DIR="$home" bash "$target_script" 2>&1)
  local status=$?
  set -e

  if [[ $status -eq 0 ]]; then
    echo "Expected non-zero exit when target dir is missing" >&2
    return 1
  fi
  if [[ "$err_output" != *"does not exist locally — run: chezmoi apply"* ]]; then
    echo "Expected missing target dir message, got: $err_output" >&2
    return 1
  fi
}

echo "Running test_work_config_resolution..."
test_work_config_resolution
echo "Running test_deeply_nested_config_resolution..."
test_deeply_nested_config_resolution
echo "Running test_git_dir_pruned..."
test_git_dir_pruned
echo "Running test_personal_config_resolution..."
test_personal_config_resolution
echo "Running test_missing_external_file..."
test_missing_external_file
echo "Running test_stale_detection..."
test_stale_detection
echo "Running test_missing_target_dir..."
test_missing_target_dir

echo "All check-superpowers-freshness tests passed!"
