# Pi Subagent Status Command Design

**Date:** 2026-07-11

## Purpose

Expose the model currently selected for `pi-subagent` without launching an agent, opening `fzf`, or querying Pi's live model catalog.

## Command contract

Add one invocation:

```text
pi-subagent --status
```

It reads the wrapper-owned state file:

```text
${XDG_STATE_HOME:-$HOME/.local/state}/pi/subagent-model
```

When that file contains its valid schema—exactly one non-empty canonical selector followed by a newline—the command writes the selector followed by a newline to standard output and exits successfully:

```text
anthropic/claude-sonnet-5
```

It starts neither Pi nor `fzf`; therefore it also works when Pi's catalog cannot be loaded, including offline.

For a missing, unreadable, empty, or multi-line state file, it exits nonzero with the existing diagnostic that instructs the user to run `pi-subagent` to choose a model. It does not silently choose a default model.

## Implementation boundary

The Bash wrapper's existing `read_selection` function owns validation and reading of persisted state. The argument dispatcher will route the single `--status` argument to that function and print its result. This reuses the state-file schema contract without coupling status to the effectful live-catalog lookup.

`usage` will document `--status` as displaying the persisted model selection.

## Testing

Add fast, deterministic unit tests using the existing temporary filesystem and fake Pi executable:

- a valid persisted selection is printed exactly and exits zero;
- missing selection is rejected and does not invoke Pi; and
- malformed persisted selection is rejected and does not invoke Pi.

Update the manual QA procedure with a step that confirms `pi-subagent --status` prints the saved selector and performs no model request. QA remains manual and excluded from automated hooks and CI.

## Non-goals

- Validating the saved selection against the current live Pi catalog.
- Displaying catalog metadata such as context window or thinking support.
- Selecting or changing the persisted model.
- Starting an agent or invoking `fzf`.
