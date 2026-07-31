# Zsh Emacs Keymap Design

## Goal

Make interactive Zsh command-line editing use Emacs-style bindings while retaining Neovim as the configured editor.

## Design

`dot_zshrc` will explicitly run `bindkey -e` after sourcing `~/.bashrc`. This overrides Zsh's inferred vi keymap after the shared Bash configuration exports `EDITOR=nvim` and `VISUAL=nvim`, without changing those editor settings.

Alternatives rejected:

- Changing `EDITOR` or `VISUAL` would alter unrelated programs.
- Configuring individual ZLE bindings would duplicate the standard Emacs keymap and be harder to maintain.

## Verification

Apply the chezmoi source state, start a fresh interactive Zsh, and assert that `main` aliases the `emacs` ZLE keymap. Confirm the repository has no unintended chezmoi drift.
