# Close Skill & Helper Herdr App Support — Short Design

## Intent & Why

Support the new Herdr app stack (`herdr-app` + `herdr-core`) when closing an agent's session/pane, and reorder precedence to **Rex → Herdr App → legacy Herdr** so inner Rex sessions close before outer Herdr App terminals and stale `HERDR_ENV=1` variables never hijack Herdr App terminals.

## Goals, Non-Goals, Anti-Goals

- **Goals:** Single source of truth in `~/.local/bin/close` (`dot_local/bin/executable_close`) used by both `close` and `clean-merge` skills; deterministic resolution strictly from inherited environment variables.
- **Non-goals:** Closing entire Herdr App tabs or spaces (Herdr App closes the pane automatically when its terminal ends).
- **Anti-goals:** Never query or act on UI focus (`herdr-app do pane.close` without an explicit target); never fall through to an outer multiplexer when an inner multiplexer's partial markers are present without its target ID.

## Constraints

- Lives in `_personal/` (no work-specific URLs or hostnames); work repo updates its `_personal` submodule pointer.
- Must work identically in local `herdr-app` panes and remote SSH spaces where no local `herdr-app` GUI window exists (`hc kill` talks to the local `herdr-core` socket).

## Approaches

1. **Unified `close` binary (Chosen):** `dot_local/bin/executable_close` resolves `Rex → Herdr App → Herdr` (killing the whole `REX_SESSION` for Rex), and `close/SKILL.md` delegates directly to `close`. Consolidates duplicated shell/Python logic and fixes helper drift; trades off pane-only Rex block closing in `clean-merge`.
2. **Pane-only `close` binary + `SKILL.md` shell wrapper:** Keep `executable_close` pane-scoped (`rex block close` → `hc kill` → `herdr pane close`) while `close/SKILL.md` overrides Rex to `rex kill`. Preserves `REX_BLOCK` closing in `clean-merge` at the cost of split precedence logic.

## Interface & Resolution Contract (`close_command(environment)`)

Evaluated in order; first matching environment family wins and fails closed (`None`) if its target ID is missing:

| Priority | Family | Match predicate | Target required | Command |
| -------- | ------ | --------------- | --------------- | ------- |
| 1 | Rex | `REX_SESSION` or `REX_BLOCK` non-empty | `REX_SESSION` | `["rex", "--autostart=false", "--timeout", "2s", "kill", "--", REX_SESSION]` |
| 2 | Herdr App (`hc`) | `HC_TERMINAL_ID`, `HC_TERMINAL_SOCKET`, or `HC_SCOPE` non-empty | `HC_TERMINAL_ID` | `["hc", "kill", "--", HC_TERMINAL_ID]` |
| 3 | Legacy Herdr | `HERDR_ENV == "1"` | `HERDR_PANE_ID` | `["herdr", "pane", "close", "--", HERDR_PANE_ID]` |

If none match or a matched family lacks its required target ID, `close` prints `close: not in a Rex session, Herdr App terminal, or Herdr pane` to stderr and exits `1`.

## Files & Unit Tests

- `_personal/dot_local/bin/executable_close`: implement `close_command` contract above.
- `_personal/dot_agents/packages/exact_devops/exact_skills/close/SKILL.md`: document the three-way behavior/precedence and invoke `close` directly (including post-worktree-removal usage).
- `_personal/dot_agents/packages/exact_coding/exact_skills/clean-merge/SKILL.md` *(builder call)*: update the one-line description of `close` to match.
- `_personal/tests/close.test.py`: unit tests with fake `environment` and `execute` covering each backend alone, pairwise/three-way precedence (`Rex > Herdr App > Herdr`), fail-closed partial environments (`REX_BLOCK` without `REX_SESSION`, `HC_TERMINAL_SOCKET`/`HC_SCOPE` without `HC_TERMINAL_ID`, `HERDR_ENV=1` without `HERDR_PANE_ID`), and `main()` exit/exec behavior.
