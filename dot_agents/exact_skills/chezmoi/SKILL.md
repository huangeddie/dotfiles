---
name: chezmoi
description:
  Use when working with chezmoi-managed dotfiles — ensures agents edit source
  state files instead of deployed targets
---

# Working with Chezmoi-Managed Dotfiles

## Golden Rules

**Always edit chezmoi source state files. Never edit deployed targets
directly.**

- **Source state** lives at `~/.local/share/chezmoi/` (or `chezmoi source-path`)
- **Deployed targets** live at `$HOME/`
- After editing source files, run `chezmoi apply` to sync to `$HOME`
- Use `chezmoi source-path <target>` to find the source file for any deployed
  target

**If a file exists in both source state and `$HOME`, edit the source state
version.**

## Agent-Relevant Commands

| Command                             | Purpose                                           |
| ----------------------------------- | ------------------------------------------------- |
| `chezmoi source-path <target>`      | Map a deployed file to its source state path      |
| `chezmoi status`                    | See what would change on apply                    |
| `chezmoi diff`                      | Show detailed changes apply would make            |
| `chezmoi apply`                     | Sync source state to `$HOME` after edits          |
| `chezmoi data`                      | Print available template variables                |
| `chezmoi execute-template <string>` | Test template fragments                           |
| `chezmoi add <path>`                | Add an existing deployed file/dir to source state |

## Naming Quick Reference

Chezmoi uses prefixes in the source state filename to control how files are
deployed.

| Source prefix         | Target result                                                 |
| --------------------- | ------------------------------------------------------------- |
| `dot_foo`             | `~/.foo`                                                      |
| `private_dot_foo`     | `~/.foo` (mode 0600)                                          |
| `executable_foo`      | `~/foo` (executable bit set)                                  |
| `symlink_foo`         | `~/foo` (symlink)                                             |
| `exact_foo/`          | `~/foo/` (exact directory — removes extra files in target)    |
| `run_foo.sh`          | Executed every `chezmoi apply`                                |
| `run_onchange_foo.sh` | Executed only when script content changes                     |
| `run_once_foo.sh`     | Executed once per unique content version                      |
| `modify_foo`          | Receives current file on stdin, writes new contents to stdout |
| `create_foo`          | Creates file if missing, does not manage contents             |
| `*.tmpl`              | Rendered through Go templates before deployment               |

Attributes can be combined: `private_executable_dot_foo` → `~/.foo` with mode
0600 and executable bit.

## Script Details

Scripts are any file with a `run_` prefix in the source directory. They are
executed during `chezmoi apply` in alphabetical order.

- **`run_`** — executed every time
- **`run_onchange_`** — executed only when content changes (tracked by hash)
- **`run_once_`** — executed once per unique content version (stored in
  database)
- **`before_` / `after_`** — control execution order relative to file updates
  - Example: `run_before_install.sh` runs before dotfiles are updated
  - Example: `run_after_install.sh` runs after dotfiles are updated
- **`.chezmoiscripts/`** — scripts in this directory are executed without
  creating a corresponding target directory
- Scripts with `.tmpl` suffix are treated as templates
- Scripts must include a `#!` shebang line (or be a binary executable)
- Do not set the executable bit in source state — chezmoi handles it
  automatically

**Scripts should be idempotent**, including `run_onchange_` and `run_once_`
scripts.

## Templating Basics

Templates change file contents based on the environment. Chezmoi uses Go's
`text/template` syntax extended with
[sprig](https://masterminds.github.io/sprig/) functions.

A file becomes a template if:

- Its name has a `.tmpl` suffix, **or**
- It is in the `.chezmoitemplates/` directory (or a subdirectory)

**Creating templates:**

- `chezmoi add --template ~/.zshrc` — add existing file as template
- `chezmoi chattr +template ~/.zshrc` — convert existing managed file to
  template
- Create manually: `dot_zshrc.tmpl` in source state

**Common template variables** (from `chezmoi data`):

- `.chezmoi.os` — operating system (e.g., `darwin`, `linux`)
- `.chezmoi.arch` — architecture (e.g., `arm64`, `amd64`)
- `.chezmoi.hostname` — machine hostname
- `.chezmoi.username` — current username
- `.chezmoi.homeDir` — home directory path
- `.chezmoi.sourceDir` — source state directory path

**Conditionals:**

```
{{ if eq .chezmoi.os "darwin" }}
# macOS-specific config
{{ else if eq .chezmoi.os "linux" }}
# Linux-specific config
{{ end }}
```

**Custom template data** can be defined in `.chezmoidata.$FORMAT` files (json,
toml, yaml) or the `data` section of the config file.

**Reusable template fragments** live in `.chezmoitemplates/` and are included
with `{{ template "name" }}`.

**Testing templates:** Use `chezmoi execute-template '{{ .chezmoi.os }}'` to
test fragments.

For full templating docs, see `docs/templating.md`.

## Package Installation

Chezmoi simulates declarative package installation with a combination of
`.chezmoidata` files and `run_onchange_` scripts.

**Pattern:**

1. Declare packages in `.chezmoidata/packages.yaml`:

   ```yaml
   packages:
     darwin:
       brews:
         - "git"
       casks:
         - "google-chrome"
   ```

2. Create a `run_onchange_darwin-install-packages.sh.tmpl` script that installs
   them:

   ```
   {{ if eq .chezmoi.os "darwin" -}}
   #!/bin/bash
   brew bundle --file=/dev/stdin <<EOF
   {{ range .packages.darwin.brews -}}
   brew {{ . | quote }}
   {{ end -}}
   {{ range .packages.darwin.casks -}}
   cask {{ . | quote }}
   {{ end -}}
   EOF
   {{ end -}}
   ```

The `run_onchange_` prefix ensures the script only re-runs when the package list
changes.

For full examples, see `docs/advanced/install-packages-declaratively.md`.

## Common Mistakes

1. **Editing deployed files instead of source state**

   - ❌ Edit `~/.agents/AGENTS.md`
   - ✅ Edit `dot_agents/AGENTS.md` in `~/.local/share/chezmoi/`
   - Use `chezmoi source-path ~/.agents/AGENTS.md` to find the correct file

2. **Forgetting to apply after source changes**

   - After editing source, run `chezmoi apply` before testing in a live shell

3. **Wrong naming prefix when adding new files**

   - Hidden files need `dot_` prefix: `dot_gitconfig` → `~/.gitconfig`
   - Private files need `private_` prefix: `private_dot_ssh/config` →
     `~/.ssh/config` (0600)

4. **Committing from the wrong directory**

   - Run `git` commands from the source directory (`~/.local/share/chezmoi/`),
     not from `$HOME`
   - Use `chezmoi cd` to open a shell in the source directory

5. **Using `run_` instead of `run_onchange_` for idempotent installs**
   - `run_install.sh` runs every apply — wasteful and slow
   - `run_onchange_install.sh` runs only when content changes

## Deep Reference

The full chezmoi user-guide is available alongside this skill in the `docs/`
directory:

- `docs/command-overview.md` — command reference and workflow diagrams
- `docs/templating.md` — complete templating guide
- `docs/use-scripts-to-perform-actions.md` — scripts, ordering, environment
  variables
- `docs/manage-different-types-of-file.md` — exact dirs, symlinks, modify
  scripts, create files
- `docs/advanced/install-packages-declaratively.md` — declarative package
  installation
- `docs/daily-operations.md` — day-to-day chezmoi usage
- `docs/setup.md` — initial setup
