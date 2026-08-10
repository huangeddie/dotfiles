# dotfiles

Personal dotfiles managed with [chezmoi](https://www.chezmoi.io/). Reference the
chezmoi skill for more info.

## Agent Harness Config

There're many terminal agent harnesses e.g. Codex CLI, Claude Code, Pi. _We aim
to decouple as much of our agent configuration from specific harness
implemenations as much as possible_.

As such, we make it an effort to put most of our agent configs including skills,
prompts, and context files under @dot_agents/.

Directory structure:

```text
dot_agents/
├── AGENTS.md                    # Shared agent instructions; applies to ~/.agents/AGENTS.md.
├── exact_plugins/               # Shared plugin marketplace; applies to ~/.agents/plugins/.
│   └── marketplace.json         # Codex marketplace catalog.
└── exact_packages/              # Shared package registry; applies to ~/.agents/packages/.
    └── <package>/
        ├── exact_skills/        # Shared skills; applies to skills/.
        ├── dot_claude-plugin/   # Claude Code manifest; applies to .claude-plugin/.
        ├── dot_codex-plugin/    # Codex CLI manifest; applies to .codex-plugin/.
        ├── gemini-extension.json
        └── package.json         # Pi package manifest.
```

Agent harnesses with configs that don't quite align with our configuration can
refer to those configs by either pointing to the resulting target path
(~/.agents/) or by symlink.

Note that we have agent-provider specific manifests like `dot_claude-plugin`
within our config. This is ok because it doesn't compromise the content of our
agnostic configs.

## Package Management

### Machine roles

Every machine must select `base`. Linux machines may also select `gaming`. Selecting `gaming` on macOS/Darwin fails validation.

| Machine | `machineRoles` |
|---|---|
| Ubuntu web host | `["base"]` |
| Ubuntu development and gaming machine | `["base", "gaming"]` |
| macOS machine | `["base"]` |

New direct installations ask about gaming during `chezmoi init`. To change an
existing machine, run `chezmoi edit-config`, then inspect `chezmoi diff` before
running `chezmoi apply`. Removing `gaming` purges the managed Steam packages.

### Package policy

A repository that composes this one can deny package-name prefixes:

```toml
[data]
machineRoles = ["base"]

[data.packagePolicy]
deniedPrefixes = ["unauthorized-prefix"]
```

Packages whose names start with a denied prefix are never installed. Managed
apt, Homebrew, and Bun packages that later become denied are removed. Custom
script installers are skipped, but their existing installations cannot be
automatically removed because they have no uninstall instruction.

`blocked_prefixes` remains accepted for older configuration during migration.
Its entries are combined with `packagePolicy.deniedPrefixes`, so either field
can deny a package. New configuration must use `packagePolicy.deniedPrefixes`.

### Retired apt packages

When a Linux apt package is retired from this repository, move it to the
durable tombstone list, such as `packages.linux.apt.remove`, rather than simply
deleting it from the package list. Tombstones tell the next apply to purge the
retired package. Disabling a role is different: it removes only the packages
managed exclusively by that inactive role and does not create a tombstone.

### Internal work composition

The internal work repository owns `.chezmoi.toml.tmpl`. It applies the
`_personal/` submodule first, then applies its work state. The work template
must provide the shared consumer settings:

```toml
[data]
machineRoles = ["base"]

[data.packagePolicy]
deniedPrefixes = ["unauthorized-prefix"]
```

Migrate an existing work repository in this safe order:

1. Add `machineRoles = ["base"]` while retaining `blocked_prefixes`.
2. Update the `_personal/` submodule.
3. Move the deny list to `[data.packagePolicy] deniedPrefixes`.
4. Preview and apply normally.

These steps may be committed atomically. The personal `.chezmoi.toml.tmpl`
does not interfere with the work config: the work script uses `chezmoi apply`,
while config templates run during `chezmoi init`.

### Verify and apply

Run the tests and inspect the selected package data and pending changes:

```bash
for test_file in tests/*.test.sh; do bash "$test_file"; done
chezmoi data | jq '{machineRoles, packagePolicy}'
chezmoi diff
```

Inspect all removals in `chezmoi diff` before `chezmoi apply`. Do not add
network or production-package QA to automated CI; run any real package changes
manually on the intended machine.

## Development Guidelines

Despite whatever skills framework like `superpowers` may suggest, this project
is small enough such that changes can be made _directly_ to main without any
worktrees. Do NOT ask the user about creating new branches or worktrees. Just
commit directly to main.
