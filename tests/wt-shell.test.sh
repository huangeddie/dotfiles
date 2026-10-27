#!/usr/bin/env bash
# Deterministic unit tests; command execution and directory changes are faked.
# Run with either bash or zsh.
set -eu
repo_dir=$(cd "$(dirname "$0")/.." && pwd)
. "$repo_dir/dot_bash_aliases"
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
typeset -f wt >/dev/null || fail 'wt shell wrapper is missing'

command() {
  if [ "$#" = 2 ] && [ "$1" = wt ] && [ "$2" = _rename-tab ]; then
    [ "$cd_calls" = 1 ] || fail 'renamed before a successful directory change'
    title_calls=$((title_calls + 1))
    return "$title_exit"
  fi
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
  unset REX_SESSION REX_BLOCK HERDR_ENV HERDR_PANE_ID HERDR_TAB_ID
  title_calls=0
  title_exit=0
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

test_cd_enters_existing_checkout_without_splitting_spaces() {
  reset
  expected_arguments='<wt><cd><feature/a>'
  wt cd feature/a
  [ "$entered" = '/tmp/work tree/repo' ] && [ "$cd_calls" = 1 ] || fail 'cd did not enter checkout'
}

test_cd_preserves_trailing_newlines_in_checkout_paths() {
  reset
  expected_arguments='<wt><cd><feature/a>'
  cli_output='/tmp/checkout
'
  wt cd feature/a
  [ "$entered" = "$cli_output" ] || fail 'cd stripped part of the checkout path'
}

test_missing_checkout_preserves_directory_and_exit_status() {
  reset
  expected_arguments='<wt><cd><missing>'
  cli_exit=1
  result=0
  wt cd missing || result=$?
  [ "$result" = 1 ] && [ "$cd_calls" = 0 ] || fail 'missing checkout changed directory or status'
}

test_list_preserves_output_and_directory() {
  reset
  expected_arguments='<wt><list>'
  cli_output='trunk /project'
  wt list
  [ "$cd_calls" = 0 ] || fail 'list changed directory'
  [ "$(wt list)" = 'trunk /project' ] || fail 'list output changed'
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
  for subcommand in new cd; do
    for help_flag in --help -h --h --he --hel -hh; do
      reset
      expected_arguments="<wt><$subcommand><$help_flag>"
      cli_output="usage: wt $subcommand ..."
      wt "$subcommand" "$help_flag"
      [ "$cd_calls" = 0 ] || fail 'help attempted a directory change'
      [ "$(wt "$subcommand" "$help_flag")" = "$cli_output" ] || fail 'help output changed'
    done
  done
}

test_navigation_renames_mux_tabs_only_after_success() {
  for subcommand in new cd; do
    for multiplexer in rex herdr; do
      reset
      if [ "$multiplexer" = rex ]; then REX_SESSION=session; else HERDR_ENV=1; fi
      expected_arguments="<wt><$subcommand><feature>"
      wt "$subcommand" feature
      [ "$title_calls" = 1 ] || fail 'successful navigation did not rename tab'
    done
  done
}

test_failed_navigation_does_not_rename_tabs() {
  for failure in command cd; do
    reset
    REX_SESSION=session
    expected_arguments='<wt><cd><feature>'
    if [ "$failure" = command ]; then cli_exit=1; else cd_exit=1; fi
    result=0
    wt cd feature || result=$?
    [ "$result" = 1 ] && [ "$title_calls" = 0 ] || fail 'failed navigation renamed tab'
  done
}

test_title_failure_does_not_fail_successful_navigation() {
  reset
  HERDR_ENV=1
  title_exit=7
  expected_arguments='<wt><cd><feature>'
  wt cd feature
  [ "$entered" = '/tmp/work tree/repo' ] && [ "$title_calls" = 1 ] || fail 'title failure affected navigation'
}

test_list_and_help_do_not_rename_tabs() {
  reset
  REX_SESSION=session
  expected_arguments='<wt><list>'
  wt list
  expected_arguments='<wt><cd><--help>'
  wt cd --help
  [ "$title_calls" = 0 ] || fail 'non-navigation renamed tab'
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
test_cd_enters_existing_checkout_without_splitting_spaces
test_cd_preserves_trailing_newlines_in_checkout_paths
test_missing_checkout_preserves_directory_and_exit_status
test_list_preserves_output_and_directory
test_failed_creation_preserves_directory_and_exit_status
test_failed_cd_returns_failure
test_other_commands_preserve_output_status_and_directory
test_help_is_forwarded_without_attempting_cd
test_no_arguments_are_forwarded_without_attempting_cd
test_navigation_renames_mux_tabs_only_after_success
test_failed_navigation_does_not_rename_tabs
test_title_failure_does_not_fail_successful_navigation
test_list_and_help_do_not_rename_tabs
printf 'PASS: wt shell navigation, forwarding, help, and failure propagation\n'
