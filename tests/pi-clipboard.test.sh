#!/usr/bin/env bash
# Run with bash or zsh; fake Pi records its inputs without launching the UI.
set -eu

repo_dir=$(cd "$(dirname "$0")/.." && pwd)
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

cat > "$tmp_dir/pi" <<'SH'
#!/bin/sh
printf 'osc52=%s\nssh=%s\n' "${PI_CLIPBOARD_OSC52-unset}" "${SSH_CLIENT-unset}"
printf 'arg=%s\n' "$@"
exit "${FAKE_PI_EXIT:-0}"
SH
chmod +x "$tmp_dir/pi"
export PATH="$tmp_dir:$PATH"
. "$repo_dir/dot_bash_aliases"
unset HERDR_ENV REX_SESSION PI_CLIPBOARD_OSC52 SSH_CLIENT

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

assert_pi_environment() {
  actual=$(pi 'two words' '')
  expected=$(printf 'osc52=%s\nssh=%s\narg=two words\narg=\n' "$1" "$2")
  [ "$actual" = "$expected" ] || fail "$3: $actual"
}

test_rex_enables_remote_copy_without_fabricating_ssh() (
  export REX_SESSION=session:test
  assert_pi_environment 1 unset 'Rex remote copying'
)

test_herdr_enables_remote_copy_without_fabricating_ssh() (
  export HERDR_ENV=1
  assert_pi_environment 1 unset 'Herdr remote copying'
)

test_local_launch_preserves_default_and_explicit_settings() (
  assert_pi_environment unset unset 'local default'
  export PI_CLIPBOARD_OSC52=0
  assert_pi_environment 0 unset 'explicit local setting'
)

test_remote_launch_preserves_real_ssh_identity() (
  export REX_SESSION=session:test SSH_CLIENT='192.0.2.1 1234 22'
  assert_pi_environment 1 '192.0.2.1 1234 22' 'real SSH identity'
)

test_remote_launch_preserves_exit_status_and_parent_environment() (
  export REX_SESSION=session:test FAKE_PI_EXIT=7
  result=0
  pi >/dev/null || result=$?
  [ "$result" = 7 ] || fail 'Pi exit status was lost'
  [ "${PI_CLIPBOARD_OSC52-unset}" = unset ] || fail 'clipboard flag leaked to parent'
  [ "${SSH_CLIENT-unset}" = unset ] || fail 'SSH marker leaked to parent'
)

test_rex_enables_remote_copy_without_fabricating_ssh
test_herdr_enables_remote_copy_without_fabricating_ssh
test_local_launch_preserves_default_and_explicit_settings
test_remote_launch_preserves_real_ssh_identity
test_remote_launch_preserves_exit_status_and_parent_environment
printf 'PASS: Pi clipboard routing, arguments, environment, and exit status\n'
