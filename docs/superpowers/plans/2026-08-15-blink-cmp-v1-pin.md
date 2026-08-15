# blink.cmp v1 Pin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Constrain `blink.cmp` to the latest compatible v1 release on fresh and existing Neovim installations.

**Architecture:** The chezmoi-owned plugin specification declares its own semver major-version constraint so bootstrap ordering cannot temporarily select `main`. After applying source state, lazy.nvim resolves and installs the selected v1 tag and updates its generated lockfile.

**Tech Stack:** Lua, Neovim 0.12, lazy.nvim, LazyVim, chezmoi

## Global Constraints

- The version constraint is `^1`.
- Continue obtaining plugin defaults and dependencies from LazyVim.
- Do not add `saghen/blink.lib` or migrate to `blink.cmp` v2.
- Edit and commit chezmoi source state, never the deployed target.

---

### Task 1: Pin and install blink.cmp v1

**Files:**
- Modify: `dot_config/nvim/lua/exact_plugins/blink-cmp.lua:2-4`
- Generated runtime state: `~/.config/nvim/lazy-lock.json`

**Interfaces:**
- Consumes: lazy.nvim's `version` plugin-spec field using semver range syntax.
- Produces: a resolved `blink.cmp` target whose tag has major version 1.

- [ ] **Step 1: Add the explicit version contract**

Change the beginning of the plugin specification to:

```lua
return {
  {
    "saghen/blink.cmp",
    version = "^1",
    opts = {
```

- [ ] **Step 2: Check and apply the chezmoi source change**

Run:

```bash
chezmoi diff -- ~/.config/nvim/lua/plugins/blink-cmp.lua
chezmoi apply -- ~/.config/nvim/lua/plugins/blink-cmp.lua
```

Expected: the deployed plugin specification gains only `version = "^1"`.

- [ ] **Step 3: Verify lazy.nvim resolves a v1 release before installation**

Run:

```bash
nvim --headless "+lua local p=require('lazy.core.config').plugins['blink.cmp']; local t=require('lazy.manage.git').get_target(p); print(t.tag, t.commit)" +qa 2>&1
```

Expected: the printed tag starts with `v1.`.

- [ ] **Step 4: Update the installed plugin and generated lockfile**

Run:

```bash
nvim --headless "+lua require('lazy').update({plugins={'blink.cmp'}, wait=true, show=false})" +qa
```

Expected: lazy.nvim checks out the latest matching v1 tag without a `blink.lib` load error after the update finishes.

- [ ] **Step 5: Verify installed and resolved versions agree**

Run:

```bash
repo="$HOME/.local/share/nvim/lazy/blink.cmp"
git -C "$repo" describe --tags --exact-match HEAD
nvim --headless "+lua print(require('blink.cmp') and 'blink.cmp loaded')" +qa
```

Expected: the exact tag starts with `v1.` and Neovim prints `blink.cmp loaded` without errors.

- [ ] **Step 6: Commit the source-state change**

Run:

```bash
git add dot_config/nvim/lua/exact_plugins/blink-cmp.lua
git commit -m "fix(nvim): pin blink.cmp to v1"
```
