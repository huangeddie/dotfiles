# Zsh Emacs Keymap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make interactive Zsh command-line editing use Emacs-style bindings while retaining Neovim as the configured editor.

**Architecture:** The chezmoi-managed Zsh startup file will explicitly select ZLE's built-in Emacs keymap after shared shell initialization. Chezmoi remains the deployment boundary between source state and `~/.zshrc`.

**Tech Stack:** Zsh ZLE, chezmoi, Git

## Global Constraints

- Keep `EDITOR` and `VISUAL` set to `nvim`.
- Edit only chezmoi source state, then deploy with `chezmoi apply`.
- This configuration-only change does not require red-green TDD.

---

### Task 1: Select and deploy the Emacs keymap

**Files:**
- Modify: `dot_zshrc`

**Interfaces:**
- Consumes: Zsh's built-in `bindkey` command and chezmoi's source-state mapping.
- Produces: An interactive Zsh session where the `main` ZLE keymap aliases `emacs`.

- [ ] **Step 1: Add the explicit keymap selection**

Append this after shared shell initialization and Zsh-specific tool setup:

```zsh
bindkey -e
```

- [ ] **Step 2: Apply the chezmoi source state**

Run:

```sh
chezmoi apply
```

Expected: `~/.zshrc` is updated from `dot_zshrc` without errors.

- [ ] **Step 3: Verify a fresh Zsh keymap**

Run:

```sh
zsh -lic 'bindkey -lL main'
```

Expected output:

```text
bindkey -A emacs main
```

- [ ] **Step 4: Verify repository and deployment state**

Run:

```sh
chezmoi diff
git diff --check
```

Expected: `chezmoi diff` emits no output and `git diff --check` exits successfully.

- [ ] **Step 5: Commit the configuration**

```sh
git add dot_zshrc
git commit -m "fix(zsh): use Emacs command-line editing"
```
