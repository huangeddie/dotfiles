# blink.cmp v1 Pin Design

## Goal

Keep the Neovim completion configuration on the latest stable `blink.cmp` v1 release and prevent a fresh lazy.nvim bootstrap from cloning the incompatible v2 development branch.

## Design

The chezmoi source-state plugin specification will declare `version = "^1"` directly alongside `"saghen/blink.cmp"`. This makes the version contract available before LazyVim itself has been installed and loaded. LazyVim may continue supplying the remaining plugin dependencies and defaults.

The existing keymap override remains unchanged. Adopting `blink.cmp` v2 and its required `saghen/blink.lib` dependency is explicitly out of scope.

## Verification

Render the managed Neovim plugin file and inspect lazy.nvim's resolved target. The resolved target must be a v1 tag. Then update `blink.cmp` through lazy.nvim so the local installation and generated lockfile no longer reference the v2 `main` commit.
