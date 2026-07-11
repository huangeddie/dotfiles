# Pi Subagent Selection Confirmation Design

**Date:** 2026-07-11

## Purpose

Confirm the exact model selector persisted after an interactive `pi-subagent` model selection.

## Command contract

After `pi-subagent` successfully accepts an `fzf` choice and atomically writes it to `${XDG_STATE_HOME:-$HOME/.local/state}/pi/subagent-model`, it writes the selected canonical selector to standard output:

```text
<provider>/<model>\n
```

This is the same output contract as `pi-subagent --status`. For example:

```text
openai-codex/gpt-5.6-luna
```

No confirmation is printed if the picker is canceled or persistence fails. Existing exit statuses and diagnostics remain unchanged.

## Components and data flow

`select_and_save_model` remains the composition point for interactive selection. Its flow becomes:

```text
live Pi catalog → fzf → validate selector → atomic state-file write → stdout selector
```

The confirmation occurs after the state-file write, so stdout only represents a newly persisted model.

## Verification

Extend the manually invoked model-selection QA procedure. It must verify that accepting a picker entry prints exactly the selected selector, followed by a newline, as well as persisting that same selector. This integration check remains outside CI, pre-commit, and pre-push.

## Non-goals

- Changing the persisted state-file schema.
- Changing `--status` output.
- Printing a confirmation for canceled or failed selections.
- Starting Pi after interactive selection.
