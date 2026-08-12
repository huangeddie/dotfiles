# Herdr Immediate New Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every built-in Herdr new-tab shortcut create a tab immediately with a Herdr-generated name.

**Architecture:** Configure Herdr's existing `ui.prompt_new_tab_name` contract in chezmoi source state. Keep the built-in `new_tab` actions unchanged and let chezmoi deploy the validated configuration.

**Tech Stack:** TOML, Herdr CLI, chezmoi

## Global Constraints

- Edit `dot_config/herdr/config.toml`, not the deployed `~/.config/herdr/config.toml`.
- Set `ui.prompt_new_tab_name` to `false`.
- Preserve all existing keybindings, including `prefix+c` and `ctrl+alt+n`.
- This is a configuration-only change, so red-green TDD does not apply.

---

### Task 1: Disable the New-Tab Name Prompt

**Files:**
- Modify: `dot_config/herdr/config.toml`

**Interfaces:**
- Consumes: Herdr's `[ui] prompt_new_tab_name: boolean` configuration field.
- Produces: A deployed Herdr configuration where all built-in `new_tab` actions use generated names without prompting.

- [ ] **Step 1: Add the Herdr UI setting**

Add the field to the existing `[ui]` table:

```toml
[ui]
agent_panel_sort = "spaces"
prompt_new_tab_name = false
```

- [ ] **Step 2: Validate the source configuration**

Run:

```bash
HERDR_CONFIG_PATH="$PWD/dot_config/herdr/config.toml" herdr config check
```

Expected: exit status 0 with valid configuration diagnostics.

- [ ] **Step 3: Inspect the deployment diff**

Run:

```bash
chezmoi diff
```

Expected: `~/.config/herdr/config.toml` gains only `prompt_new_tab_name = false` under `[ui]`.

- [ ] **Step 4: Apply the managed configuration**

Run:

```bash
chezmoi apply
```

Expected: exit status 0.

- [ ] **Step 5: Verify the deployed contract**

Run:

```bash
HERDR_CONFIG_PATH="$HOME/.config/herdr/config.toml" herdr config check
grep -Fx 'prompt_new_tab_name = false' "$HOME/.config/herdr/config.toml"
git diff --check
```

Expected: both checks exit 0, grep prints the setting, and `git diff --check` emits no output.

- [ ] **Step 6: Commit the implementation**

```bash
git add dot_config/herdr/config.toml
git commit -m "fix(herdr): create new tabs without prompting"
```
