# Pi Subagent Model Selection QA

Run this procedure manually after applying the chezmoi source changes. It is not part of CI, pre-commit, or pre-push.

## Preconditions

- `pi --list-models` prints at least one selectable model.
- `fzf` is installed and can render in the current terminal.
- Run `chezmoi apply` so `~/.local/bin/pi-subagent` uses the updated source.

## Procedure

1. Remove only the wrapper's local state:

   ```bash
   rm -f "${XDG_STATE_HOME:-$HOME/.local/state}/pi/subagent-model"
   ```

2. Verify a prompt is rejected before selection:

   ```bash
   pi-subagent "Reply with exactly: should not run"
   ```

   Expected: a nonzero exit and a diagnostic telling you to run `pi-subagent`; no model request is made.

3. Run `pi-subagent` with no arguments, select a visible model in `fzf`, and accept it.

   Expected: the picker closes successfully, prints exactly the selected `provider/model` selector plus newline, and `${XDG_STATE_HOME:-$HOME/.local/state}/pi/subagent-model` contains that same selector plus newline.

4. Verify the persisted model can be displayed without starting Pi:

   ```bash
   pi-subagent --status
   ```

   Expected: it prints exactly the selected `provider/model` selector and exits successfully; no model request is made.

5. Verify the saved model is usable:

   ```bash
   pi-subagent "Reply with exactly: selected model works"
   ```

   Expected: Pi runs with the selected model and prints `selected model works`.

6. Verify the one-call override leaves persisted state unchanged:

   ```bash
   before="$(cat "${XDG_STATE_HOME:-$HOME/.local/state}/pi/subagent-model")"
   pi-subagent --model "$before" "Reply with exactly: override works"
   test "$before" = "$(cat "${XDG_STATE_HOME:-$HOME/.local/state}/pi/subagent-model")"
   ```

   Expected: Pi prints `override works`; the final `test` exits zero.
