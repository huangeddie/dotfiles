#!/usr/bin/env bash
# Run with bash or zsh; SSH is replaced so no network connection is made.
set -eu

repo_dir=$(cd "$(dirname "$0")/.." && pwd)
. "$repo_dir/dot_bash_aliases"

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

# A fake SSH records its invocation and can simulate connection failure.
ssh() {
  printf '%s\n' "$@"
  return "${ssh_exit_code:-0}"
}

test_port_forwards_only_loopback_to_same_remote_port() {
  actual=$(fwd 52341)
  expected=$(printf '%s\n' -N -o ExitOnForwardFailure=yes -L \
    127.0.0.1:52341:localhost:52341 eddie@mac)
  [ "$actual" = "$expected" ] || fail 'incorrect SSH forwarding arguments'
}

test_invalid_argument_count_prints_usage_without_starting_ssh() {
  for argument_count in 0 2; do
    set --
    if [ "$argument_count" = 2 ]; then set -- 52341 extra; fi
    result=0
    output=$(fwd "$@" 2>&1) || result=$?
    [ "$result" = 2 ] || fail 'invalid argument count must return 2'
    case "$output" in
      'Usage: fwd <port>') ;;
      *) fail 'expected usage without an SSH invocation' ;;
    esac
  done
}

test_ssh_failure_returns_ssh_exit_status() {
  ssh_exit_code=255
  result=0
  fwd 52341 >/dev/null || result=$?
  [ "$result" = 255 ] || fail 'SSH failure status was lost'
}

test_port_forwards_only_loopback_to_same_remote_port
test_invalid_argument_count_prints_usage_without_starting_ssh
test_ssh_failure_returns_ssh_exit_status
printf 'PASS: fwd forwarding, usage, and failure propagation\n'
