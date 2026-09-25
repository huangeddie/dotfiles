# Todoist Television channel

Manual QA only: these commands contact Todoist. Do not add them to CI or hooks.
Requires authenticated `td`, Bun, and Television 0.15.9 or newer.

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
  ~/.config/television/todoist.toml ~/.config/television/todoist.ts
chezmoi apply --include=files ~/.config/television/cable/todoist.toml \
  ~/.config/television/todoist.toml ~/.config/television/todoist.ts
```

## Agent-driven checks

```sh
bun test tests/television-todoist.test.ts
# Run both real source commands; prints counts rather than private task content.
bun - <<'JS'
const path = `${process.env.XDG_CONFIG_HOME || `${process.env.HOME}/.config`}/television`;
const channel = Bun.TOML.parse(await Bun.file(`${path}/cable/todoist.toml`).text());
for (const source of channel.source.command) {
  const child = Bun.spawn(['sh', '-c', source.run], { stdout: 'pipe', stderr: 'pipe' });
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  if (code) throw new Error(`${source.name}: ${err}`);
  const rows = out.trimEnd() ? out.trimEnd().split('\n') : [];
  for (const row of rows) {
    if (!/^[a-zA-Z0-9_-]+\t[^\t\r\n]*$/.test(row)) throw new Error('Invalid task row');
  }
  if (source.name === 'Scheduled') {
    const dates = rows.map(row => row.split('\t')[1].split(' ')[0]);
    if (dates.some((date, index) => index > 0 && date < dates[index - 1])) {
      throw new Error('Scheduled is not in due-date order');
    }
  }
  console.log(`${source.name}: ${rows.length} valid rows`);
}
JS
tv list-channels | grep '^todoist$'
```

Repeat with different projects configured for each tab, then with one tab's
project empty. Each tab should use only its own scope. The unscoped mode resolves
section names per project because `td section list` requires a project argument.

## Human-driven checks

Run `tv todoist`:

- Scheduled shows dated tasks in ascending ISO calendar-date/time order;
  all-day tasks precede timed tasks on the same day. Overdue tasks remain visible.
- Ctrl+S switches to Backlog, containing only tasks without due dates. A deadline
  alone does not make a task scheduled.
- Both tabs prefix sectioned task names with `[Section]`.
- Task previews work; Enter opens the selected task in Todoist's web app.
- Each tab contains only tasks from its own configured project; an empty project
  setting shows all projects without inheriting the other tab's setting.
