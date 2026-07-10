# Pi Subagent Model Selection Design

**Date:** 2026-07-10

## Purpose

Allow the user to choose and persist the model used by the `pi-subagent` wrapper without duplicating Pi's provider/model registry. Pi remains the source of truth for which models are currently selectable.

## Data schema

### Pi catalog input

The wrapper obtains the current catalog by invoking Pi's public CLI:

```text
pi --list-models
```

It consumes each data row as a model record with these positional fields:

| Field | Source column | Use |
| --- | --- | --- |
| `provider` | 1 | Forms the canonical selector |
| `model` | 2 | Forms the canonical selector |
| `details` | remaining columns | Picker display only |

The canonical selector is:

```text
<provider>/<model>
```

The wrapper has no separately managed model catalog. Consequently, Pi upgrades, `~/.pi/agent/models.json` customizations, and available authentication are reflected in the next selection or invocation.

### Persisted selection

The wrapper alone owns the untracked state file:

```text
${XDG_STATE_HOME:-$HOME/.local/state}/pi/subagent-model
```

Its schema is exactly one valid canonical selector followed by a newline:

```text
openai-codex/gpt-5.6-luna\n
```

The parent directory is created as needed. Updates use a temporary file in that directory followed by atomic rename, with restrictive permissions. Chezmoi does not manage this location.

## Command contract

```text
pi-subagent
pi-subagent <prompt>
pi-subagent --model <provider/model> <prompt>
pi-subagent --list-models
pi-subagent --help
```

| Invocation | Behavior |
| --- | --- |
| No arguments | Load the live Pi catalog, show an `fzf` picker, and persist the chosen selector. Do not start an agent. |
| `<prompt>` | Require that persisted selector to be in the live Pi catalog, then invoke Pi with it. |
| `--model <selector> <prompt>` | Require the selector to be in the live Pi catalog, invoke Pi with it, and leave state unchanged. |
| `--list-models` | Print the current live Pi catalog without invoking `fzf` or an agent. |
| `--help` | Print usage and exit successfully. |

The child invocation is always:

```text
pi --model <canonical-selector> -p <prompt>
```

The provider flag is intentionally not sent separately: the provider-qualified selector is the single model-routing contract.

## Components and data flow

`executable_pi-subagent` remains a Bash composition root. It contains small, single-purpose helpers:

1. `list_models` runs `pi --list-models`, rejects malformed rows, and exposes records with a canonical selector plus display text.
2. `select_model` requires `fzf`, renders live records, accepts a selection, and returns only the canonical selector.
3. `read_selection` and `write_selection` perform the state-file effects.
4. `require_available_model` verifies a selector is in the live catalog.
5. `parse_arguments` resolves the invocation into one of `select`, `list`, `help`, or `run(selector, prompt)`.
6. `run_pi` executes the child Pi process.

For a prompt run, the flow is:

```text
arguments → selector (state or override) → live Pi catalog validation
          → pi --model <selector> -p <prompt>
```

For an empty invocation:

```text
pi --list-models → fzf → atomic state-file write
```

## Error behavior

The wrapper exits nonzero and never starts a child agent for:

- no persisted selection when a prompt is supplied;
- a persisted selection no longer present in the live Pi catalog;
- an override absent from the live Pi catalog;
- an empty catalog or malformed catalog row;
- unavailable `fzf` for interactive selection;
- canceled picker;
- unreadable state, catalog, or state directory; and
- malformed arguments.

It never silently chooses a default model or replaces stale state. Diagnostics state the corrective action, normally `pi-subagent` to select a model again.

## Testing

Tests isolate deterministic argument parsing, catalog-row parsing, picker-result extraction, state validation, and construction of the Pi argument vector. Fakes replace Pi catalog output, `fzf`, and filesystem operations so unit tests remain fast and deterministic.

The actual `pi --list-models`, `fzf`, and child Pi integration is covered by a manually invoked QA procedure. It is not added to pre-commit, pre-push, or CI.

## Non-goals

- Maintaining a duplicate or wrapper-specific model allowlist.
- Changing Pi's global interactive model preference.
- Persisting per-project selections.
- Changing `models.json`, authentication, provider configuration, or Pi's model registry.
