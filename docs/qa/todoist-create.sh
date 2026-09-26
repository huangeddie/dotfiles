#!/bin/bash
# Discretionary offline effect-boundary QA; never run in CI or install hooks.
set -euo pipefail

repo=$(cd "$(dirname "$0")/../.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
export HOME="$tmp/home" XDG_CONFIG_HOME="$tmp/config" BUN_INSTALL="$tmp/bun-home"
export PATH="$tmp/bin:$PATH" QA_LOG="$tmp/calls"
mkdir -p "$HOME" "$XDG_CONFIG_HOME/todoist" "$tmp/bin"

cat >"$tmp/bin/bun" <<'EOF'
#!/bin/sh
printf 'bun' >>"$QA_LOG"
printf ' <%s>' "$@" >>"$QA_LOG"
printf '\n' >>"$QA_LOG"
EOF
cat >"$tmp/bin/td" <<'EOF'
#!/bin/sh
exit 0
EOF
chmod +x "$tmp/bin/bun" "$tmp/bin/td"
launcher="$repo/dot_local/bin/executable_todoist-add"
installer="$repo/run_onchange_after_install-todoist-dependencies.sh.tmpl"
fail() { echo "offline Todoist QA: $*" >&2; exit 1; }

mkdir -p "$tmp/empty"
if PATH="$tmp/empty" "$launcher" >"$tmp/out" 2>"$tmp/err"; then
  fail 'launcher ran without Bun'
fi
grep -q 'requires Bun' "$tmp/err" || fail 'missing Bun message'
mv "$tmp/bin/td" "$tmp/td"
if PATH="$tmp/bin" "$launcher" >"$tmp/out" 2>"$tmp/err"; then
  fail 'launcher ran without td'
fi
grep -q 'requires td' "$tmp/err" || fail 'missing td message'
mv "$tmp/td" "$tmp/bin/td"

: >"$QA_LOG"
if "$launcher" 'two words' '--due=next weekend' >"$tmp/out" 2>"$tmp/err"; then
  fail 'launcher ran without dependencies'
fi
grep -q 'dependencies are missing' "$tmp/err" || fail 'missing dependency message'
[[ ! -s "$QA_LOG" ]] || fail 'launcher silently installed dependencies'
mkdir -p "$XDG_CONFIG_HOME/todoist/node_modules/@opentui/core"
"$launcher" 'two words' '--due=next weekend'
grep -Fqx "bun <--no-install> <$XDG_CONFIG_HOME/todoist/create.ts> <two words> <--due=next weekend>" "$QA_LOG" || fail 'XDG path or argv forwarding'

# Render with controlled chezmoi data; fake Bun prevents any actual installation.
render_and_run() {
  local policy=$1 legacy=$2
  chezmoi --source "$repo" --override-data "{\"machineRoles\":[\"base\"],\"machineRolePolicy\":{\"required\":[\"base\"],\"platforms\":{\"linux\":[\"base\",\"gaming\"],\"darwin\":[\"base\"]}},\"packagePolicy\":{\"deniedPrefixes\":$policy},\"blocked_prefixes\":$legacy}" \
    execute-template -f "$installer" >"$tmp/installer.sh"
  bash "$tmp/installer.sh"
}
: >"$QA_LOG"
render_and_run '[]' '[]'
grep -Fqx "bun <install> <--cwd> <$HOME/.config/todoist> <--frozen-lockfile>" "$QA_LOG" || fail 'frozen install missing'
for denied in '@opentui' '@doist/todoist-cli' 'bun'; do
  : >"$QA_LOG"
  render_and_run "[\"$denied\"]" '[]' >"$tmp/out"
  grep -q 'Skipping Todoist form dependencies' "$tmp/out" || fail "deny message missing for $denied"
  [[ ! -s "$QA_LOG" ]] || fail "installed denied $denied"
done
: >"$QA_LOG"
render_and_run '[]' '["@opentui"]' >"$tmp/out"
grep -q 'Skipping Todoist form dependencies' "$tmp/out" || fail 'legacy deny message missing'
[[ ! -s "$QA_LOG" ]] || fail 'installed legacy-denied package'
echo 'Todoist offline launcher and installer QA passed'
