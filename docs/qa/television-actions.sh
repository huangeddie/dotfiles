#!/usr/bin/env bash
# Manual, offline QA of real subprocess/filesystem boundaries; never run in CI/hooks.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
helper=${1:-"$root/dot_config/television/actions.ts"}
BUN=$(command -v bun)
export BUN
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
export XDG_STATE_HOME="$scratch/state"
export TD_QA_LOG="$scratch/calls"
mkdir -p "$scratch/bin"
export PATH="$scratch/bin:$PATH"
# This executable cannot reach Todoist; it records the real runner's argv.
cat > "$scratch/bin/td" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$TD_QA_LOG"
[[ "$1" == --no-spinner ]]
if [[ "$2" == section && "$3" == list ]]; then echo '{"results":[]}'; exit 0; fi
[[ "$2" == task ]]
if [[ "${TD_QA_FAIL:-}" == "$3" ]]; then
  echo 'td unavailable' >&2
  exit 1
fi
case "$3" in
  view) printf '{"id":"%s","checked":false,"isUncompletable":false}\n' "${4#id:}" ;;
  complete|uncomplete) ;;
  list) echo '{"results":[]}' ;;
  *) exit 1 ;;
esac
SH
chmod +x "$scratch/bin/td"
run() { "$BUN" "$helper" "$@"; }
fail() { echo "$*" >&2; exit 1; }
expect_failure() {
  if "$@" > "$scratch/out" 2> "$scratch/err"; then fail 'Expected failure'; fi
}
state="$XDG_STATE_HOME/television/todoist/completion.json"
lock="$XDG_STATE_HOME/television/todoist/lock"
run undo
[[ ! -e "$TD_QA_LOG" ]] || fail 'Empty undo called td'
run complete one
grep -qx '"one"' "$state"
run complete two
grep -qx '"two"' "$state"
TD_QA_FAIL=complete expect_failure run complete three
grep -qx '"two"' "$state"
grep -q 'td unavailable' "$scratch/err"
[[ ! -e "$lock" ]] || fail 'Failed action leaked lock'
TD_QA_FAIL=uncomplete expect_failure run undo
grep -qx '"two"' "$state"
run undo
grep -qx 'null' "$state"
grep -qx -- '--no-spinner task uncomplete id:two' "$TD_QA_LOG"
cp "$TD_QA_LOG" "$scratch/before"
run undo
cmp "$TD_QA_LOG" "$scratch/before"
expect_failure run complete 'one two'
cmp "$TD_QA_LOG" "$scratch/before"
printf '{}\n' > "$state"
expect_failure run undo
cmp "$TD_QA_LOG" "$scratch/before"
grep -q 'task ID' "$scratch/err"
mkdir "$lock"
expect_failure run complete one
grep -q 'Another Todoist action' "$scratch/err"
cmp "$TD_QA_LOG" "$scratch/before"
rmdir "$lock"
run complete one
[[ ! -e "$lock" && ! -e "$state.tmp" ]] || fail 'Action left temporary files'
"$BUN" -e 'import {statSync} from "node:fs"; if ((statSync(process.argv[1]).mode & 0o777) !== 0o600) throw Error("State is not private")' "$state"
for tab in scheduled backlog; do
  "$BUN" "$root/dot_config/television/todoist.ts" "$tab" > "$scratch/rows"
  printf 'No active tasks\t\n' > "$scratch/expected"
  cmp "$scratch/rows" "$scratch/expected"
done
printf 'PASS: CLI persistence, error propagation, locking, private state, and empty-tab output\n'
