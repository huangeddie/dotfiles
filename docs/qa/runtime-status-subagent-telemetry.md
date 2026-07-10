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

2. In the Pi prompt, ask the assistant to invoke the subagent wrapper:

   ```text
   Run: pi-subagent "Reply with exactly: child complete"
   ```

3. Wait for the subprocess to finish and the assistant to respond.

## Expected observations

- The root runtime status line transitions from tool wait time to child
  generation/idle time (or child tool time) after the subprocess completes.
- The assistant receives only the literal output:

  ```text
  child complete
  ```

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

- The root runtime status totals (generation + tool wait + idle) are each less
  than or equal to the elapsed wall time since the session started.
- No `PI_RUNTIME_STATUS_REPORT_PATH` value or JSON report appears in the
  shell output or conversation transcript.

## When to run

Run this procedure after any change to:

- `dot_pi/agent/exact_extensions/runtime-status.ts`
- `dot_pi/agent/runtime-status-core.ts`
- `pi-subagent` wrapper or the way it reports runtime status
