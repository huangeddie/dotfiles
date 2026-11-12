# Close Skill & Helper Herdr App Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support Herdr App (`herdr-core` / `hc`) in the unified `close` binary and `close` skill with precedence **Rex → Herdr App → legacy Herdr**.

**Architecture:** Consolidate environment resolution and closing command construction into `_personal/dot_local/bin/executable_close` (`close_command(environment)`), failing closed whenever an active multiplexer family lacks its target ID. Simplify `_personal/dot_agents/packages/exact_devops/exact_skills/close/SKILL.md` to invoke `close` directly so both `close` and `clean-merge` share one tested entry point.

**Tech Stack:** Python 3 (`unittest`, `os.execvp`), Chezmoi, Git (`_personal` submodule + work repo).

**Spec:** `_personal/docs/superpowers/specs/2026-11-12-close-herdr-app-design.md`

## Global Constraints

- Edit chezmoi source files under `_personal/`, never deployed files under `$HOME` directly; deploy only the three affected personal targets via `chezmoi --persistent-state "$HOME/.config/chezmoi/personal-state.boltdb" --source "$HOME/.local/share/chezmoi/_personal" apply`.
- Never include Google-internal URLs, hostnames, or paths inside `_personal/` files or commit messages.
- Resolution order is strictly:
  1. Rex (`REX_SESSION` or `REX_BLOCK` non-empty; requires `REX_SESSION`) → `["rex", "--autostart=false", "--timeout", "2s", "kill", "--", REX_SESSION]`
  2. Herdr App (`HC_TERMINAL_ID`, `HC_TERMINAL_SOCKET`, or `HC_SCOPE` non-empty; requires `HC_TERMINAL_ID`) → `["hc", "kill", "--", HC_TERMINAL_ID]`
  3. Legacy Herdr (`HERDR_ENV == "1"`; requires `HERDR_PANE_ID`) → `["herdr", "pane", "close", "--", HERDR_PANE_ID]`
- Missing context error message on stderr: `close: not in a Rex session, Herdr App terminal, or Herdr pane` (exit status `1`).
- Never execute `close`, `hc kill`, `rex kill`, or `herdr pane close` against the live agent terminal during verification.
- Commit locally with Conventional Commits; do not `git push`.

## Review Focus

- Option-like target IDs (e.g. `REX_SESSION="-s"`, `HC_TERMINAL_ID="-h"`, `HERDR_PANE_ID="--pane"`): every command argv places `"--"` immediately before the target ID so CLI parsers treat it positionally.
- Inactive `HERDR_ENV` values (`{"HERDR_ENV": "0", "HERDR_PANE_ID": "pane-3"}`): only `"1"` activates legacy Herdr; other values return `None`.
- Empty-string environment variables (`{"REX_SESSION": "", "REX_BLOCK": "", "HC_TERMINAL_ID": "t3d"}`): empty strings do not match an outer/inactive family and fall through to active lower-priority families.
- Session-only vs partial Rex (`{"REX_SESSION": "session:1"}` vs `{"REX_BLOCK": "block:2", "HC_TERMINAL_ID": "t3d"}`): `REX_SESSION` alone succeeds without `REX_BLOCK`, while `REX_BLOCK` without `REX_SESSION` fails closed (`None`) instead of killing `t3d`.
- Partial Herdr App environment (`{"HC_TERMINAL_SOCKET": "/tmp/hc.sock", "HERDR_ENV": "1", "HERDR_PANE_ID": "pane-3"}` and `{"HC_SCOPE": "scope-1", "HERDR_ENV": "1", "HERDR_PANE_ID": "pane-3"}`): fails closed (`None`) instead of falling through to legacy Herdr.

---

### Task 1: Unified `close` Binary, Unit Tests, and Skill Docs (`_personal`)

**Files:**
- Modify: `_personal/tests/close.test.py`
- Modify: `_personal/dot_local/bin/executable_close`
- Modify: `_personal/dot_agents/packages/exact_devops/exact_skills/close/SKILL.md`
- Modify: `_personal/dot_agents/packages/exact_coding/exact_skills/clean-merge/SKILL.md`

**Interfaces:**
- Produces:
  - `close_command(environment: Mapping[str, str]) -> list[str] | None` in `_personal/dot_local/bin/executable_close`
  - `main(environment: Mapping[str, str] = os.environ, execute: Callable[[str, list[str]], object] = os.execvp) -> int` in `_personal/dot_local/bin/executable_close`
  - Deployed `~/.local/bin/close`, `~/.agents/packages/devops/skills/close/SKILL.md`, and `~/.agents/packages/coding/skills/clean-merge/SKILL.md`

- [ ] **Step 1: Baseline-test the existing `close/SKILL.md` (RED — skill)**

Dispatch a read-only subagent scenario (do not execute commands; ask what exact shell command it would run as its final tool call) given the current `_personal/dot_agents/packages/exact_devops/exact_skills/close/SKILL.md` under `HC_TERMINAL_ID=t3d`, `HERDR_ENV=1`, `HERDR_PANE_ID=w1:p1` and under `REX_SESSION=s1`, `HERDR_ENV=1`, `HERDR_PANE_ID=w1:p1`.
Expected: Baseline violates the new contract (prefers `HERDR_ENV` over `REX_SESSION`, and has no `HC_TERMINAL_ID` / Herdr App handling).

- [ ] **Step 2: Write failing unit tests in `_personal/tests/close.test.py` (RED — code)**

Replace the test suite in `_personal/tests/close.test.py` with tests covering:
- `test_rex_session_kills_entire_session_without_requiring_rex_block`: `close_command({"REX_SESSION": "session:1"}) == ["rex", "--autostart=false", "--timeout", "2s", "kill", "--", "session:1"]`
- `test_herdr_app_terminal_kills_its_own_hc_terminal`: `close_command({"HC_TERMINAL_ID": "t3d"}) == ["hc", "kill", "--", "t3d"]`
- `test_herdr_pane_closes_its_own_pane`: `close_command({"HERDR_ENV": "1", "HERDR_PANE_ID": "pane-3"}) == ["herdr", "pane", "close", "--", "pane-3"]`
- `test_rex_takes_precedence_over_herdr_app_and_herdr`: `close_command({"REX_SESSION": "session:1", "HC_TERMINAL_ID": "t3d", "HERDR_ENV": "1", "HERDR_PANE_ID": "pane-3"}) == ["rex", "--autostart=false", "--timeout", "2s", "kill", "--", "session:1"]`
- `test_herdr_app_takes_precedence_over_legacy_herdr`: `close_command({"HC_TERMINAL_ID": "t3d", "HERDR_ENV": "1", "HERDR_PANE_ID": "pane-3"}) == ["hc", "kill", "--", "t3d"]`
- `test_empty_outer_markers_fall_through_to_active_backend`: `close_command({"REX_SESSION": "", "REX_BLOCK": "", "HC_TERMINAL_ID": "t3d"}) == ["hc", "kill", "--", "t3d"]` and `close_command({"HC_TERMINAL_ID": "", "HC_TERMINAL_SOCKET": "", "HC_SCOPE": "", "HERDR_ENV": "1", "HERDR_PANE_ID": "pane-3"}) == ["herdr", "pane", "close", "--", "pane-3"]`
- `test_rex_block_without_session_fails_closed_above_herdr_app`: `close_command({"REX_BLOCK": "block:2", "HC_TERMINAL_ID": "t3d"}) is None`
- `test_herdr_app_socket_or_scope_without_terminal_id_fails_closed_above_herdr`: both `{"HC_TERMINAL_SOCKET": "/tmp/hc.sock", "HERDR_ENV": "1", "HERDR_PANE_ID": "pane-3"}` and `{"HC_SCOPE": "scope-1", "HERDR_ENV": "1", "HERDR_PANE_ID": "pane-3"}` return `None`
- `test_herdr_without_pane_id_returns_none`: `close_command({"HERDR_ENV": "1"}) is None`
- `test_non_active_herdr_env_value_with_pane_id_returns_none`: `close_command({"HERDR_ENV": "0", "HERDR_PANE_ID": "pane-3"}) is None`
- `test_option_like_target_ids_stay_after_double_dash`: `REX_SESSION="-s"`, `HC_TERMINAL_ID="-h"`, and `HERDR_PANE_ID="--pane"` each appear immediately after `"--"` at index `-1`
- `test_no_multiplexer_returns_none`: `close_command({}) is None`
- `MainTest.test_main_execs_resolved_command`: verifies `(file, argv)` passed to `execute` for Herdr App (`("hc", ["hc", "kill", "--", "t3d"])`)
- `MainTest.test_main_without_multiplexer_prints_error_and_exits_nonzero_without_exec`: verifies status `1`, `calls == []`, and `"Rex session, Herdr App terminal, or Herdr pane"` in stderr

- [ ] **Step 3: Run unit tests to verify failure**

Run: `python3 _personal/tests/close.test.py`
Expected: FAIL (`REX_SESSION` without `REX_BLOCK` returns `None`, `HC_TERMINAL_ID` returns `None`, `HERDR_ENV` still beats `REX_SESSION`).

- [ ] **Step 4: Implement `close_command` and `main` in `_personal/dot_local/bin/executable_close` (GREEN — code)**

Update `close_command(environment)` and `main(environment=os.environ, execute=os.execvp)` in `_personal/dot_local/bin/executable_close` to implement the three-tier fail-closed contract (`Rex → Herdr App → Legacy Herdr`) and error message from Global Constraints.

- [ ] **Step 5: Run unit tests to verify pass**

Run: `python3 _personal/tests/close.test.py`
Expected: PASS (all 14 tests `OK`).

- [ ] **Step 6: Update `close/SKILL.md` and `clean-merge/SKILL.md` (GREEN — skill)**

Update `_personal/dot_agents/packages/exact_devops/exact_skills/close/SKILL.md` so that:
- Frontmatter keeps `name: close` and `description: Use when asked to close the agent's pane, tab, terminal, or multiplexer session.`
- Prose states the behavior and priority order (**Rex** kills the entire `REX_SESSION`; **Herdr App** ends the `HC_TERMINAL_ID` terminal via `hc`, closing its pane and sub-agents; **Herdr** closes only the `HERDR_PANE_ID` pane; priority order is **Rex → Herdr App → Herdr**).
- Instructs finishing any reporting first, then running `close` as the final tool call (`close` resolves strictly from inherited environment, never UI focus; if `close` exits nonzero, report its error instead of choosing another target or calling UI commands).
- Instructs appending `close` after successful worktree removal in the same Bash call.

Update line 36 of `_personal/dot_agents/packages/exact_coding/exact_skills/clean-merge/SKILL.md` to:
`` `close` closes your Rex session, Herdr App terminal, or Herdr pane; see the `close` skill. ``

- [ ] **Step 7: Re-run the subagent skill scenario with updated `close/SKILL.md`**

Dispatch a fresh read-only subagent with the updated `close/SKILL.md` asking what command it runs to close under Herdr App (`HC_TERMINAL_ID=t3d`, `HERDR_ENV=1`), nested Rex-in-Herdr-App (`REX_SESSION=s1`, `HC_TERMINAL_ID=t3d`), after worktree removal, and if `close` fails.
Expected: Runs `close` as its final tool call, chains `&& close` in the same Bash call for worktree removal, and reports errors without probing UI focus (`herdr-app do pane.close`, etc.).

- [ ] **Step 8: Deploy personal targets and verify deployed files**

Run:
```bash
chezmoi --persistent-state "$HOME/.config/chezmoi/personal-state.boltdb" \
  --source "$HOME/.local/share/chezmoi/_personal" \
  apply --no-tty \
  "$HOME/.local/bin/close" \
  "$HOME/.agents/packages/devops/skills/close/SKILL.md" \
  "$HOME/.agents/packages/coding/skills/clean-merge/SKILL.md" </dev/null
REX_SESSION= REX_BLOCK= HC_TERMINAL_ID= HC_TERMINAL_SOCKET= HC_SCOPE= HERDR_ENV= "$HOME/.local/bin/close"; test "$?" -eq 1
diff -u _personal/dot_local/bin/executable_close "$HOME/.local/bin/close"
diff -u _personal/dot_agents/packages/exact_devops/exact_skills/close/SKILL.md "$HOME/.agents/packages/devops/skills/close/SKILL.md"
git -C _personal diff --check
```
Expected: `apply` exits `0`, empty-env `~/.local/bin/close` prints `close: not in a Rex session, Herdr App terminal, or Herdr pane` and exits `1`, both `diff -u` commands exit `0` with no output, and `git -C _personal diff --check` emits nothing.

- [ ] **Step 9: Commit in `_personal`**

```bash
git -C _personal add \
  dot_local/bin/executable_close \
  tests/close.test.py \
  dot_agents/packages/exact_devops/exact_skills/close/SKILL.md \
  dot_agents/packages/exact_coding/exact_skills/clean-merge/SKILL.md \
  docs/superpowers/specs/2026-11-12-close-herdr-app-design.md \
  docs/superpowers/plans/2026-11-12-close-herdr-app.md
git -C _personal commit -m "feat(close): support herdr-app and prioritize rex over herdr"
```

---

### Task 2: Bump `_personal` Submodule in Work Chezmoi Repo

**Files:**
- Modify: `_personal` (gitlink in `~/.local/share/chezmoi`)

**Interfaces:**
- Consumes: `_personal` `HEAD` commit from Task 1.
- Produces: Clean work repository pointing to the updated `_personal` commit.

- [ ] **Step 1: Verify submodule diff and privacy check**

Run:
```bash
git --no-pager -C _personal show --stat HEAD
git --no-pager diff --submodule=log _personal
```
Expected: Shows only the new `_personal` commit (`feat(close): support herdr-app and prioritize rex over herdr`) with no internal hostnames or URLs.

- [ ] **Step 2: Commit the updated `_personal` submodule pointer**

```bash
git add _personal
git commit -m "chore(personal): bump submodule for close herdr-app support"
git status
```
Expected: Commit succeeds and `git status` reports a clean working tree.
