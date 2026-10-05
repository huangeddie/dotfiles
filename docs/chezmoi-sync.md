# Chezmoi sync

`chezmoi-sync` checks deployed Superpowers skills against their upstream Git
branch, compares chezmoi's rendered state with deployed `.agents/` and
`.codex/AGENTS.md`, and compares installed `local-agents` plugin caches with
`.agents/packages/<name>/`. Snapshots include contents, executable bits and
symlink targets. It uses the configured chezmoi source and destination;
a conflicting `CODEX_HOME` fails before changes.

```sh
chezmoi-sync --check        # 0 current, 1 stale, 2 error
chezmoi-sync                # Apply, install, verify, restart Codex daemon
chezmoi-sync --no-restart   # Sync without restarting
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
updates are not implemented yet.

## Layered sources

A consuming repository (e.g. the internal work repository, which nests this
repository as `_personal/`) declares extra chezmoi sources applied before its
own in its chezmoi data:

```yaml
chezmoiLayers:
  - source: _personal                       # relative to the configured source
    persistentState: personal-state.boltdb  # relative to the chezmoi config dir
```

Without `chezmoiLayers`, only the configured source is used. Each source checks
and applies only the targets it manages (`chezmoi source-path`), layers first in
declared order, then the configured source; later sources override earlier ones
when both manage the same target path.

Each layer is an upstream dependency: `git fetch` compares it with its tracking
branch. Behind is stale; unpublished commits and missing upstreams are
informational. Sync aborts before any change if a layer has uncommitted tracked
changes or has diverged, otherwise fast-forwards it (`git merge --ff-only`)
before applying. Sync does not commit the parent repository's new submodule
pointer or apply the layer's non-agent dotfiles; it prints a reminder to commit
the pointer and run `chezmoi apply`.

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

This command replaces `sync-upstream`, `sync-codex`,
`check-superpowers-freshness`, and `refresh-codex`; chezmoi removes the old executables on apply. `--refresh`
remains an alias for `--sync`. Register the local marketplace on new machines
with `codex plugin marketplace add ~` after applying dotfiles.

Requires Python 3, Git, chezmoi, and a Codex CLI supporting `plugin list --json`,
`plugin remove`, `plugin add`, and `app-server daemon restart`.

The Codex CLI is detected by `codex --version` printing `codex-cli …`; another
`codex` on `PATH` does not count. Without it, plugin checks, reinstallation,
and daemon restart are skipped with a notice; layers and skills still sync.

## Verification

Deterministic unit tests use fake command runners and in-memory filesystem data:

```sh
python3 tests/chezmoi-sync.test.py
```

Manual QA exercises real filesystem and chezmoi effects in temporary fixtures:

```sh
python3 docs/qa/chezmoi-sync.py
chezmoi-sync --check  # Live network and installed Codex checks
```

Keep QA out of hooks and CI. Real plugin reinstallation and daemon restart
must be checked manually when interruption is acceptable.
