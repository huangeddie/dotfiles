# Todoist Television channel

Manual QA only: the live checks contact Todoist. Do not add QA to CI or hooks.
Live checks require authenticated `td`, Bun, and Television 0.15.9 or newer.

## Configuration

Edit `dot_config/television/todoist.toml` in the chezmoi source state:

```toml
# Each tab independently selects all projects (empty), a name, or id:PROJECT_ID.
[scheduled]
project = ""

[backlog]
project = ""
```

Preview and deploy only these files:

```sh
chezmoi diff ~/.config/television/cable/todoist.toml \
  ~/.config/television/todoist.toml ~/.config/television/todoist.ts \
  ~/.config/television/actions.ts
chezmoi apply --include=files ~/.config/television/cable/todoist.toml \
  ~/.config/television/todoist.toml ~/.config/television/todoist.ts \
  ~/.config/television/actions.ts
```

## Agent-driven checks

```sh
bun test tests/television-todoist.test.ts tests/television-actions.test.ts
# Offline, discretionary QA: real subprocesses/filesystem, isolated state, fake td.
bash docs/qa/television-actions.sh
# Run both real source commands; prints counts rather than private task content.
bun - <<'JS'
const path = `${process.env.XDG_CONFIG_HOME || `${process.env.HOME}/.config`}/television`;
const channel = Bun.TOML.parse(await Bun.file(`${path}/cable/todoist.toml`).text());
for (const source of channel.source.command) {
  const started = performance.now();
  const child = Bun.spawn(['sh', '-c', source.run], { stdout: 'pipe', stderr: 'pipe' });
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  if (code) throw new Error(`${source.name}: ${err}`);
  const plain = Bun.stripANSI(out);
  const rows = plain.replace(/\n$/, '').split('\n')
    .filter(row => row !== '' && row !== 'No active tasks\t');
  for (const row of rows) {
    if (!/^[^\t\r\n]*\t[a-zA-Z0-9_-]+$/.test(row)) throw new Error('Invalid task row');
  }
  if (source.name === 'Scheduled') {
    const dates = rows.map(row => row.split('\t')[0].split(' ')[0]);
    if (dates.some((date, index) => index > 0 && date < dates[index - 1])) {
      throw new Error('Scheduled is not in due-date order');
    }
  }
  console.log(`${source.name}: ${rows.length} valid rows in ${((performance.now() - started) / 1000).toFixed(3)}s`);
}
JS
tv list-channels | grep '^todoist$'
```

Repeat with different projects configured for each tab, then with one tab's
project empty. Each tab should use only its own scope. The unscoped mode resolves
section names per project because `td section list` requires a project argument.
Only projects with sectioned tasks in the selected tab are queried, in batches
of at most four concurrent requests. Scoped tabs fetch tasks and sections in
parallel. No data is cached; rerunning a source always fetches fresh data.
Compare timings manually, not with automated wall-clock thresholds.

## Human-driven checks

Run `tv todoist`:

- Scheduled shows dated tasks in ascending ISO calendar-date/time order;
  all-day tasks precede timed tasks on the same day. Overdue tasks remain visible.
- Ctrl+S switches to Backlog, containing only tasks without due dates. A deadline
  alone does not make a task scheduled.
- Both tabs prefix sectioned task names with `[Section]` and show dimmed task IDs
  at the end (Television ANSI mode cannot also hide IDs with a display template).
- Scheduled due dates are red when overdue, yellow today, and default-colored in
  the future. Classification uses the local calendar date when the source loads;
  reload or reopen after midnight. Only the date, not the task label, is colored.
- Task previews work; Enter opens the selected task in Todoist's web app.
- On a disposable non-recurring task, Ctrl+D completes it and refreshes the
  current tab without exiting Television. Ctrl+Z reopens that task and refreshes.
- Complete two disposable tasks, then undo: only the second reopens. Pressing
  Ctrl+Z again does nothing. Undo does not act on the currently highlighted row.
- On a disposable recurring task, completion advances its due date. Ctrl+Z
  consumes the undo slot but leaves the task active with the advanced date,
  matching native `td task uncomplete` semantics.
- Completing the last task leaves a selectable `No active tasks` placeholder;
  Ctrl+Z still works. The placeholder has no preview and cannot be completed.
- If a search matches no rows (including after completion), clear it with Ctrl+U
  before undoing: Television 0.15.9 requires a selected row for every action.
- Selecting multiple tasks with Tab and pressing Ctrl+D must show an error and
  change nothing. Clear the selection before retrying with one task.
- Action failures remain visible until acknowledged with Enter. A failed
  completion preserves the preceding undo slot; a failed undo can be retried.
- Each tab contains only tasks from its own configured project; an empty project
  setting shows all projects without inheriting the other tab's setting.

## Undo state

The single undo slot is a task ID (JSON string, or `null` after undo) in
`${XDG_STATE_HOME:-$HOME/.local/state}/television/todoist/completion.json`.
It is private (0600), survives restarts, and is shared by both tabs and all
Television instances. Only completions through this cable update it. Use the
same active `td` account when completing and undoing; changing accounts is not
tracked. To discard a stale slot, remove `completion.json`.

Actions acquire a directory lock and replace the state file atomically. If an
action is forcibly killed, remove the adjacent `lock` directory only after
confirming no action is running. As with any local undo journal, an interruption
between a successful Todoist mutation and the local write can leave stale state;
check the task in Todoist before retrying. External edits to the task between
completion and undo are not rolled back.
