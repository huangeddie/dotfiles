#!/usr/bin/env bash
# Deterministic unit tests; command execution and directory changes are faked.
# Run with either bash or zsh.
set -eu
repo_dir=$(cd "$(dirname "$0")/.." && pwd)
. "$repo_dir/dot_bash_aliases"
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
typeset -f wt >/dev/null || fail 'wt shell wrapper is missing'
complete_log=$(mktemp)
trap 'rm -f "$complete_log"' EXIT

command() {
  if [ "$#" = 2 ] && [ "$1" = wt ] && [ "$2" = _rename-tab ]; then
    [ "$cd_calls" = 1 ] || fail 'renamed before a successful directory change'
    title_calls=$((title_calls + 1))
    return "$title_exit"
  fi
  if [ "$#" = 3 ] && [ "$1" = wt ] && [ "$2" = _complete ] && [ "$3" = cd ]; then
    printf 'called\n' >> "$complete_log"
    if [ -n "$complete_output" ]; then
      printf '%s\n' "$complete_output"
    fi
    return "$complete_exit"
  fi
  [ "$(printf '<%s>' "$@")" = "$expected_arguments" ] || fail 'CLI arguments changed'
  printf '%s\n' "$cli_output"
  return "$cli_exit"
}

complete_call_count() {
  wc -l < "$complete_log" | tr -d ' '
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
  : > "$complete_log"
  complete_exit=0
  complete_output=''
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

test_new_preserves_quoted_display_name_as_one_argument() {
  reset
  REX_SESSION=session
  expected_arguments='<wt><new><Foo Bar>'
  wt new "Foo Bar"
  [ "$cd_calls" = 1 ] && [ "$title_calls" = 1 ] || fail 'named sandbox was not entered and titled'
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

test_cd_completion_suggests_matching_worktree_branches() {
  if [ -n "${BASH_VERSION:-}" ]; then
    complete -p wt | grep -q -- '-F _wt_complete wt' || fail 'bash completion for wt is not registered'
    reset
    complete_output='trunk
feature/a
feature/b'
    COMP_WORDS=(wt cd '')
    COMP_CWORD=2
    _wt_complete
    [ "$(complete_call_count)" = 1 ] || fail 'bash completion did not query wt _complete cd'
    [ "${#COMPREPLY[@]}" = 3 ] || fail 'bash completion did not return all branches'
    [ "${COMPREPLY[0]}" = trunk ] && [ "${COMPREPLY[1]}" = 'feature/a' ] && [ "${COMPREPLY[2]}" = 'feature/b' ] || fail 'bash completion returned wrong branches'

    reset
    complete_output='trunk
feature/a
feature/b'
    COMP_WORDS=(wt cd 'feat')
    COMP_CWORD=2
    _wt_complete
    [ "${#COMPREPLY[@]}" = 2 ] || fail 'bash completion did not filter by prefix'
    [ "${COMPREPLY[0]}" = 'feature/a' ] && [ "${COMPREPLY[1]}" = 'feature/b' ] || fail 'bash completion filtered wrong branches'
  elif [ -n "${ZSH_VERSION:-}" ]; then
    typeset -f _wt_zsh_complete >/dev/null || fail 'zsh completion function is missing'
    reset
    complete_output='trunk
feature/a
feature/b'
    compadd_calls=0
    compadd_result=''
    compadd() {
      compadd_calls=$((compadd_calls + 1))
      [ "$1" = -a ] || fail 'zsh completion did not pass -a to compadd'
      shift
      [ "$1" = -- ] && shift
      eval "compadd_result=\${(j:,:)$1}"
    }
    words=(wt cd '')
    CURRENT=3
    _wt_zsh_complete
    [ "$(complete_call_count)" = 1 ] && [ "$compadd_calls" = 1 ] || fail 'zsh completion did not invoke compadd'
    [ "$compadd_result" = 'trunk,feature/a,feature/b' ] || fail "zsh completion passed unexpected candidates: $compadd_result"
    unset -f compadd

    compdef_args=''
    compdef() { compdef_args="$*"; }
    . "$repo_dir/dot_bash_aliases"
    [ "$compdef_args" = '_wt_zsh_complete wt' ] || fail "zsh compdef registration mismatch: $compdef_args"
    unset -f compdef
  fi
}

test_cd_completion_ignores_other_subcommands_positions_and_errors() {
  if [ -n "${BASH_VERSION:-}" ]; then
    reset
    complete_output='trunk'
    COMP_WORDS=(wt new '')
    COMP_CWORD=2
    _wt_complete
    [ "$(complete_call_count)" = 0 ] && [ "${#COMPREPLY[@]}" = 0 ] || fail 'bash completion ran for non-cd subcommand'

    reset
    complete_output='trunk'
    COMP_WORDS=(wt cd trunk '')
    COMP_CWORD=3
    _wt_complete
    [ "$(complete_call_count)" = 0 ] && [ "${#COMPREPLY[@]}" = 0 ] || fail 'bash completion ran for extra cd argument'

    reset
    complete_exit=1
    COMP_WORDS=(wt cd '')
    COMP_CWORD=2
    _wt_complete
    [ "$(complete_call_count)" = 1 ] && [ "${#COMPREPLY[@]}" = 0 ] || fail 'bash completion did not handle CLI failure'
  elif [ -n "${ZSH_VERSION:-}" ]; then
    compadd_calls=0
    compadd() { compadd_calls=$((compadd_calls + 1)); }

    reset
    complete_output='trunk'
    words=(wt new '')
    CURRENT=3
    _wt_zsh_complete
    [ "$(complete_call_count)" = 0 ] && [ "$compadd_calls" = 0 ] || fail 'zsh completion ran for non-cd subcommand'

    reset
    complete_output='trunk'
    words=(wt cd trunk '')
    CURRENT=4
    _wt_zsh_complete
    [ "$(complete_call_count)" = 0 ] && [ "$compadd_calls" = 0 ] || fail 'zsh completion ran for extra cd argument'

    reset
    complete_exit=1
    words=(wt cd '')
    CURRENT=3
    _wt_zsh_complete
    [ "$(complete_call_count)" = 1 ] && [ "$compadd_calls" = 0 ] || fail 'zsh completion did not handle CLI failure'
    unset -f compadd
  fi
}

test_new_enters_the_returned_path_without_splitting_spaces
test_new_preserves_quoted_display_name_as_one_argument
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
test_cd_completion_suggests_matching_worktree_branches
test_cd_completion_ignores_other_subcommands_positions_and_errors
printf 'PASS: wt shell navigation, forwarding, help, completion, and failure propagation\n'
