# dotfiles

Personal dotfiles managed with [chezmoi](https://www.chezmoi.io/). The working directory **is** chezmoi's source state — files here are sources/templates that get rendered into `$HOME` by `chezmoi apply`. Edits here change the live system on the next apply.

## Layout

Files are named with chezmoi's source-state conventions. What lives here:

- `dot_bashrc`, `dot_zshrc` — shell rc files. `bashrc` defines a `btop` wrapper that picks a light/dark Flexoki theme from the terminal background (OSC 11) with an XDG portal fallback.
- `dot_bash_aliases`, `dot_zsh_aliases` — shared aliases (`lg`, `lj`, `c`, `cz`, `vault`, …). Kept in sync by hand — when adding an alias, update both unless it's shell-specific.
- `dot_gitconfig`, `dot_prettierrc`, `dot_tmux.conf` — tool configs.
- `dot_config/` — XDG configs: `bat`, `btop` (with Flexoki light/dark themes), `ghostty` (incl. shaders), `jjui`, `lazygit`, `nvim`, `omarchy`.
- `private_dot_claude/` — Claude Code `settings.json` and skills (deployed at `~/.claude`, mode 0600). Heads up: this is the same directory Claude Code itself reads from, so changes here affect Claude's own behavior.
- `private_dot_ssh/` — SSH `config` with Tailscale host aliases (`main`, `minipc`). Work-only aliases are intentionally kept out.

## Naming conventions (chezmoi source state)

- `dot_foo` → `~/.foo`
- `private_foo` → `~/foo` with mode 0600
- `private_dot_foo` → `~/.foo` with mode 0600
- `executable_foo` → `~/foo` with the executable bit
- `*.tmpl` → rendered as a Go text/template before being written

When adding or renaming a managed file, use these prefixes — don't create plain `.foo` files in the source tree.

## Usage

```sh
chezmoi init --apply git@github.com:<you>/dotfiles.git   # first-time setup on a new machine
chezmoi diff                                              # preview changes
chezmoi apply                                             # write changes to $HOME
chezmoi edit <target>                                     # edit a managed file
cz                                                        # alias for `chezmoi`
```

If a rendered file in `$HOME` has already been edited out-of-band, prefer `chezmoi re-add <target>` to pull those changes back into the source state instead of overwriting them.

## .chezmoiignore

`README.md` and `CLAUDE.md` are listed in `.chezmoiignore` so they stay in the repo and are never written into `$HOME`. Add any other repo-only files (e.g. `LICENSE`, CI config) to `.chezmoiignore` too.
