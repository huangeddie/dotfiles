# Codex sync

`sync-codex` compares chezmoi's rendered state with deployed `.agents/`
and `.codex/AGENTS.md`, then compares installed `local-agents` plugin cache
contents with `.agents/packages/<name>/`. It checks file contents, executable
bits, and symlink targets in plugin snapshots. It uses the configured chezmoi
source and destination; a conflicting `CODEX_HOME` fails before changes.

```sh
sync-codex --check        # Read-only inspection: 0 current, 1 stale, 2 error
sync-codex                # Apply, install, verify disk state, restart daemon
sync-codex --no-restart   # Sync disk state while deferring restart
```

Sync force-applies only the two target paths above, excluding chezmoi scripts,
and refreshes their external sources. As with `chezmoi apply --force`, local
edits under those targets are overwritten and extra files in exact directories
can be removed. It does not apply Codex's config or unrelated dotfiles.

Installed local plugins are removed and reinstalled through Codex's CLI so
same-version cached contents are replaced. After applying, sync discovers every
package containing
`.codex-plugin/plugin.json` under `.agents/packages/` and installs any missing
plugins from `local-agents`. Future Codex packages are included automatically
when their manifests and marketplace entries are added. Packages without a Codex
manifest are skipped. Remote plugins are untouched. Disabled local plugins cause sync
to stop before mutations because the CLI lacks an enable/disable command to
restore their state. If reinstallation fails, the script reports the command
needed to recover that plugin and does not restart the daemon.

Run the default sync from a separate terminal: daemon restart can interrupt
active work. **Start a new conversation afterward.** Existing conversation
history cannot be refreshed, and standalone clients may also need restarting.
`--check` reports missing local plugin installations as stale, as well as disk
freshness, relative to chezmoi's currently cached
external sources; it does not establish that an upstream external has not changed.

The script reports local memory extraction counts when the known SQLite schema
is available. It cannot judge whether remembered facts are stale. It does not
edit memory databases or delete conversation history. No stored refresh stamp
is treated as proof that a running session has loaded current instructions.

The command replaces `refresh-codex`; chezmoi removes the old executable on
apply. `--refresh` remains accepted as an alias for `--sync`.
The `local-agents` marketplace must be registered (on a new machine, run
`codex plugin marketplace add ~` after applying the dotfiles).

Requires Python 3, chezmoi, and a Codex CLI supporting `plugin list --json`,
`plugin remove`, `plugin add`, and `app-server daemon restart`.

Deterministic unit tests use fake command runners and in-memory file snapshots:

```sh
python3 tests/codex-sync.test.py
```

Manual QA exercises real chezmoi and filesystem effects in a temporary fixture:

```sh
python3 docs/qa/codex-sync.py
sync-codex --check
```

Keep QA out of hooks and CI. Real plugin reinstallation and daemon restart must
be checked manually when interruption is acceptable.
