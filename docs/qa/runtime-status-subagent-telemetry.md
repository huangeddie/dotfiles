# Manual QA: Runtime Status Subagent Telemetry

This document describes a manual QA procedure for verifying that the
`runtime-status` extension correctly accounts for time spent inside
`pi-subagent` subprocesses, without leaking telemetry implementation details
into the shell output or conversation transcript.

This procedure is **manual only** and must not be added to `bun test`,
pre-commit hooks, CI, or the `pi-subagent` wrapper.

## Prerequisites

- The `runtime-status` extension is deployed (e.g. via `chezmoi apply`).
- The `pi-subagent` wrapper is available on `PATH`.
- Pi is installed and configured with a provider that supports tool use.

## Procedure

1. Deploy the latest dotfiles and move to a scratch directory:

   ```bash
   chezmoi apply
   cd /tmp
   pi
   ```

2. Leave Pi waiting at the editor for at least five seconds. Confirm that the
   stopwatch and `idle` duration increase while `other` does not.

3. Invoke `read`, `write`, and `edit`. Confirm their exclusive wall time appears
   under `files`, while Bash and other ordinary tools appear under `tools`.

4. Submit a normal prompt. Confirm processing gaps not covered by provider or
   tool intervals appear under `other`, not `idle`.

5. In the Pi prompt, ask the assistant to invoke the subagent wrapper:

   ```text
   Run: pi-subagent "Reply with exactly: child complete"
   ```

6. Wait for the subprocess to finish and the assistant to respond.

## Expected observations

- The root runtime status categories satisfy this invariant, allowing only
  display-rounding differences:

  ```text
  model generation + file operations + tool wait + idle + other = stopwatch walltime
  ```

- Every category remains bounded by the displayed stopwatch.
- The assistant receives only the literal output:

  ```text
  child complete
  ```

- The child `model`, `files`, `tools`, `idle`, and `other` categories replace
  only the attributable Bash tool time; unrelated Bash tool time remains under
  `tools`.
- The shell output and the conversation transcript do **not** contain
  `PI_RUNTIME_STATUS_REPORT_PATH` or any JSON runtime status report.

## Nested subagent check

To verify totals remain bounded by wall time with deeper nesting:

1. In the same Pi session, ask the assistant to run a subagent that itself
   invokes `pi-subagent` exactly once:

   ```text
   Run: pi-subagent "Call pi-subagent once with the prompt 'Reply with exactly: nested child complete' and return the final answer."
   ```

2. Wait for both subprocesses to finish.

## Expected observations for nested check

- The final assistant response contains only the nested child output, e.g.:

  ```text
  nested child complete
  ```

- The nested child `model`, `files`, `tools`, `idle`, and `other` categories
  replace only their attributable Bash tool time at each nesting level.
- The root categories remain bounded by and sum to the displayed stopwatch,
  allowing only display-rounding differences.
- No `PI_RUNTIME_STATUS_REPORT_PATH` value or JSON report appears in the
  shell output or conversation transcript.

## When to run

Run this procedure after any change to:

- `dot_pi/agent/exact_extensions/runtime-status.ts`
- `dot_pi/agent/runtime-status-core.ts`
- `pi-subagent` wrapper or the way it reports runtime status
