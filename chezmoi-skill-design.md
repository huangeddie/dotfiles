# Design: Chezmoi Skill for Agent Context

## Goal
A compact skill that teaches agents how to safely work with chezmoi-managed dotfiles, preventing the common mistake of editing deployed files instead of source files.

## Deployment
Deployed via chezmoi itself:
- **Source state:** `dot_agents/skills/chezmoi/SKILL.md`
- **Deployed to:** `~/.agents/skills/chezmoi/SKILL.md`

## Reference Docs
The full chezmoi user-guide is copied alongside the skill for deep reference:
- **Source:** `dot_agents/skills/chezmoi/docs/`
- **Deployed:** `~/.agents/skills/chezmoi/docs/`

Includes: `command-overview.md`, `templating.md`, `use-scripts-to-perform-actions.md`, `advanced/install-packages-declaratively.md`, `manage-different-types-of-file.md`, `daily-operations.md`, `setup.md`, and subdirectories (`advanced/`, `machines/`, `frequently-asked-questions/`, etc.)

## Skill Structure (Approach A — Golden Rules)

### Frontmatter
- `name: chezmoi`
- `description: Use when working with chezmoi-managed dotfiles — ensures agents edit source state files instead of deployed targets`

### Sections

1. **Golden Rules** (top, impossible to miss)
   - Always edit chezmoi **source state** files, never deployed targets
   - Source state lives at `~/.local/share/chezmoi/`
   - Deployed targets live at `$HOME/`
   - After source edits, run `chezmoi apply` to sync to `$HOME`

2. **Agent-Relevant Commands**
   - `chezmoi source-path <target>` — map a deployed file to its source state path (critical for finding the right file to edit)
   - `chezmoi status` — see what would change on apply
   - `chezmoi diff` — show detailed changes apply would make
   - `chezmoi apply` — sync source state to $HOME after edits
   - `chezmoi data` — print available template variables
   - `chezmoi execute-template <string>` — test template fragments
   - `chezmoi add <path>` — add an existing deployed file/dir to source state

3. **Naming Quick Reference** (table)
   | Source prefix | Target result |
   |---|---|
   | `dot_foo` | `~/.foo` |
   | `private_dot_foo` | `~/.foo` (mode 0600) |
   | `executable_foo` | `~/foo` (executable bit) |
   | `symlink_foo` | `~/foo` (symlink) |
   | `exact_foo/` | `~/foo/` (exact — removes extra files in target) |
   | `run_foo.sh` | executed every `chezmoi apply` |
   | `run_onchange_foo.sh` | executed only when content changes |
   | `run_once_foo.sh` | executed once per unique content version |
   | `modify_foo` | receives current file contents on stdin, writes new contents to stdout |
   | `create_foo` | creates file if missing, does not manage contents |
   | `*.tmpl` | rendered through Go templates before deployment |

4. **Script Details**
   - Scripts are any file with `run_` prefix in the source directory
   - Executed in alphabetical order during `chezmoi apply`
   - `before_` / `after_` attributes control ordering (e.g., `run_before_install.sh`)
   - `.chezmoiscripts/` directory: scripts executed without creating a target directory
   - Scripts with `.tmpl` suffix are treated as templates
   - Scripts must include a `#!` shebang line (or be a binary)
   - No need to set the executable bit in source state — chezmoi handles it

5. **Templating Basics** (brief, for future use)
   - Files become templates if: (a) `.tmpl` suffix, or (b) in `.chezmoitemplates/` directory
   - Add with `chezmoi add --template <path>` or convert with `chezmoi chattr +template <target>`
   - Common variables from `chezmoi data`: `.chezmoi.os`, `.chezmoi.arch`, `.chezmoi.hostname`, `.chezmoi.username`, `.chezmoi.homeDir`, `.chezmoi.sourceDir`
   - Conditionals: `{{ if eq .chezmoi.os "darwin" }}...{{ end }}`
   - Use `chezmoi execute-template` to test fragments
   - `.chezmoidata.$FORMAT` files (json/toml/yaml) declare custom template data
   - `.chezmoitemplates/` for reusable template fragments

6. **Package Installation** (brief, for future use)
   - Declarative pattern: `.chezmoidata/packages.yaml` + `run_onchange_install-packages.sh.tmpl`
   - Script templates can conditionally install per OS (e.g., `brew` on darwin, `apt` on linux)
   - `run_onchange_` ensures script only runs when package list changes
   - See `docs/advanced/install-packages-declaratively.md` for full examples

7. **Common Mistakes**
   - Editing `~/.agents/AGENTS.md` instead of `dot_agents/AGENTS.md`
   - Forgetting to `chezmoi apply` after source changes
   - Adding new files without the `dot_` / `private_dot_` prefix
   - Committing from `$HOME` instead of from the source directory (`chezmoi cd`)
   - Using `run_` instead of `run_onchange_` for idempotent package installs

## Success Criteria
- Agent reads the skill before editing any file in `~/.local/share/chezmoi/`
- Agent never edits a deployed target (e.g., `~/.bashrc`) when the source exists
- Agent knows to `chezmoi apply` after making source changes
