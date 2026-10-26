#!/usr/bin/env bash
# Deterministic unit tests; command execution and directory changes are faked.
# Run with either bash or zsh.
set -eu
repo_dir=$(cd "$(dirname "$0")/.." && pwd)
. "$repo_dir/dot_bash_aliases"
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
typeset -f wt >/dev/null || fail 'wt shell wrapper is missing'

command() {
  [ "$(printf '<%s>' "$@")" = "$expected_arguments" ] || fail 'CLI arguments changed'
  printf '%s\n' "$cli_output"
  return "$cli_exit"
}

builtin() {
  [ "$#" = 3 ] && [ "$1" = cd ] && [ "$2" = -- ] || fail 'unexpected shell operation'
  entered=$3
  cd_calls=$((cd_calls + 1))
  return "$cd_exit"
}

reset() {
  cli_output='/tmp/work tree/repo'
  cli_exit=0
  cd_exit=0
  entered=''
  cd_calls=0
}

test_new_enters_the_returned_path_without_splitting_spaces() {
  reset
  expected_arguments='<wt><new><feature/a><--base><release>'
  wt new feature/a --base release
  [ "$entered" = '/tmp/work tree/repo' ] && [ "$cd_calls" = 1 ] || fail 'new did not enter sandbox'
}

test_failed_creation_preserves_directory_and_exit_status() {
  reset
  expected_arguments='<wt><new><feature>'
  cli_exit=7
  result=0
  wt new feature || result=$?
  [ "$result" = 7 ] && [ "$cd_calls" = 0 ] || fail 'failed creation changed directory or status'
}

test_failed_cd_returns_failure() {
  reset
  expected_arguments='<wt><new><feature>'
  cd_exit=3
  result=0
  wt new feature || result=$?
  [ "$result" = 3 ] || fail 'directory change failure was hidden'
}

test_other_commands_preserve_output_status_and_directory() {
  reset
  expected_arguments='<wt><remove><feature><--force>'
  cli_output='CLI output'
  cli_exit=8
  result=0
  wt remove feature --force || result=$?
  [ "$result" = 8 ] && [ "$cd_calls" = 0 ] || fail 'remove was not forwarded'
  output=$(wt remove feature --force) || :
  [ "$output" = 'CLI output' ] || fail 'CLI output changed'
}

test_help_is_forwarded_without_attempting_cd() {
  for help_flag in --help -h --h --he --hel -hh; do
    reset
    expected_arguments="<wt><new><$help_flag>"
    cli_output='usage: wt new ...'
    wt new "$help_flag"
    [ "$cd_calls" = 0 ] || fail 'help attempted a directory change'
    [ "$(wt new "$help_flag")" = 'usage: wt new ...' ] || fail 'help output changed'
  done
}

test_no_arguments_are_forwarded_without_attempting_cd() {
  reset
  expected_arguments='<wt>'
  cli_output='usage: wt ...'
  cli_exit=2
  result=0
  wt || result=$?
  [ "$result" = 2 ] && [ "$cd_calls" = 0 ] || fail 'no-argument invocation changed'
}

test_new_enters_the_returned_path_without_splitting_spaces
test_failed_creation_preserves_directory_and_exit_status
test_failed_cd_returns_failure
test_other_commands_preserve_output_status_and_directory
test_help_is_forwarded_without_attempting_cd
test_no_arguments_are_forwarded_without_attempting_cd
printf 'PASS: wt shell navigation, forwarding, help, and failure propagation\n'
