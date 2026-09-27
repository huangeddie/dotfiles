# Upstream sync

`sync-upstream` checks deployed Superpowers skills against their upstream Git
branch, compares chezmoi's rendered state with deployed `.agents/` and
`.codex/AGENTS.md`, and compares installed `local-agents` plugin caches with
`.agents/packages/<name>/`. Snapshots include contents, executable bits and
symlink targets. It uses the configured chezmoi source and destination;
a conflicting `CODEX_HOME` fails before changes.

```sh
sync-upstream --check        # 0 current, 1 stale, 2 error
sync-upstream                # Apply, install, verify, restart Codex daemon
sync-upstream --no-restart   # Sync without restarting
```

Both modes require network access: the Superpowers check shallow-clones the
configured upstream branch into a temporary directory, removed afterward.
`--check` does not apply files or change plugins. The upstream URL is read from
the Superpowers skills section of `.chezmoiexternal.toml`, including nested
work-repository sources, excluding `.git`. `CHEZMOI_SOURCE_DIR` can override
source discovery. The configured chezmoi destination determines target paths.
The supported URL format is `https://github.com/OWNER/REPO/archive/refs/heads/BRANCH.tar.gz`.

Only Superpowers currently has a live upstream freshness check. Other managed
files are checked against chezmoi's cached state. Generic imported-repository
or Git submodule updates are not implemented yet.

Sync force-applies only `.agents/` and `.codex/AGENTS.md`, excluding scripts,
and refreshes their external sources. **Local edits under those targets are
overwritten and extra files in exact directories can be removed.** It does not
apply Codex's config or unrelated dotfiles.

Installed local plugins are removed and reinstalled through Codex's CLI to
replace same-version caches. After applying, every package with a
`.codex-plugin/plugin.json` manifest is discovered and missing plugins are
installed from `local-agents`. Remote plugins are untouched. Disabled local
plugins cause sync to stop before mutations because their state cannot be
restored through the CLI. Installation failures report a recovery command.
Disk and live upstream checks must pass before daemon restart; if upstream
changes during sync, verification can fail and the command must be rerun.

Run sync from a separate terminal: daemon restart can interrupt active work.
**Start a new conversation afterward.** Existing conversation instructions
cannot be refreshed; standalone clients may also need restarting.
Memory extraction counts are informational, not proof of semantic freshness.
No memory databases or conversation histories are modified.

This command replaces `sync-codex`, `check-superpowers-freshness`, and
`refresh-codex`; chezmoi removes the old executables on apply. `--refresh`
remains an alias for `--sync`. Register the local marketplace on new machines
with `codex plugin marketplace add ~` after applying dotfiles.

Requires Python 3, Git, chezmoi, and a Codex CLI supporting `plugin list --json`,
`plugin remove`, `plugin add`, and `app-server daemon restart`.

## Verification

Deterministic unit tests use fake command runners and in-memory filesystem data:

```sh
python3 tests/sync-upstream.test.py
```

Manual QA exercises real filesystem and chezmoi effects in temporary fixtures:

```sh
python3 docs/qa/sync-upstream.py
sync-upstream --check  # Live network and installed Codex checks
```

Keep QA out of hooks and CI. Real plugin reinstallation and daemon restart
must be checked manually when interruption is acceptable.
