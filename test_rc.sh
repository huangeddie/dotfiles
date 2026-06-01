#!/bin/bash

# Mock boq release create-candidate function
LAST_BOQ_ARGS=""
boq() {
  if [[ "$1" == "release" && "$2" == "create-candidate" ]]; then
    LAST_BOQ_ARGS="${@:3}"
  else
    echo "Unexpected boq call: $*" >&2
    return 1
  fi
}

# Extract and evaluate the rc() function from dot_bash_aliases.tmpl
# Note: We ignore the template lines like {{ include ... }} during sourcing
BASH_ALIASES_PATH="$(dirname "$0")/../dot_bash_aliases.tmpl"

if ! grep -q "^rc() {" "$BASH_ALIASES_PATH"; then
  echo "ERROR: rc() function not found in dot_bash_aliases.tmpl (Expected RED state)"
  exit 1
fi

eval "$(sed -n '/^rc() {/,/^}/p' "$BASH_ALIASES_PATH")"

# Helper to assert expected outputs
assert_target() {
  local args="$1"
  local expected_target="$2"
  
  LAST_BOQ_ARGS=""
  rc $args >/dev/null 2>&1
  local exit_code=$?

  if [[ $exit_code -ne 0 ]]; then
    echo "FAIL: 'rc $args' exited with non-zero code $exit_code"
    return 1
  fi

  # Check if the target is the last argument passed to boq
  # Standard args: -skip_confirmation -deploy_to_autopush -wait_for_candidate=false <target>
  local actual_target="${LAST_BOQ_ARGS##* }"
  if [[ "$actual_target" != "$expected_target" ]]; then
    echo "FAIL: 'rc $args' targeted '$actual_target' but expected '$expected_target'"
    return 1
  fi
  echo "PASS: 'rc $args' -> $expected_target"
  return 0
}

assert_error() {
  local args="$1"
  rc $args >/dev/null 2>&1
  local exit_code=$?
  if [[ $exit_code -eq 0 ]]; then
    echo "FAIL: 'rc $args' succeeded but expected failure"
    return 1
  fi
  echo "PASS: 'rc $args' failed as expected"
  return 0
}

# Run tests
FAILED=0
assert_target "" "//photos/editing/agents/server" || FAILED=1
assert_target "agent" "//photos/editing/agents/server" || FAILED=1
assert_target "agents" "//photos/editing/agents/server" || FAILED=1
assert_target "feds" "//java/com/google/social/boq/release/photosdataserver" || FAILED=1
assert_target "pds" "//java/com/google/social/boq/release/photosdataserver" || FAILED=1
assert_target "photosdataserver" "//java/com/google/social/boq/release/photosdataserver" || FAILED=1
assert_error "invalid_target" || FAILED=1

if [[ $FAILED -eq 0 ]]; then
  echo "ALL TESTS PASSED!"
  exit 0
else
  echo "SOME TESTS FAILED!"
  exit 1
fi
