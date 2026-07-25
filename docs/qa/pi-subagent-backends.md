# Pi subagent backend manual QA

> **Manual QA only. Do not add this procedure to hooks or CI.**

## Prerequisites

- Authenticate both production CLIs: `pi` and `claude`.
- Use a trusted, disposable repository. These checks invoke production models and may read or modify files according to the selected agent tools.
- Back up `.chezmoidata/pi/subagents.yaml`. In its existing `subagents.assignments` mapping, replace **only** these four assignment values; do not replace the whole file or alter the sibling `subagents.models` and `subagents.tools` mappings:

  ```yaml
  subagents:
    assignments:
      scout: claude-haiku-5
      planner: gpt-5.6-terra
      reviewer: claude-sonnet-5
      worker: gpt-5.6-terra

    # Preserve the existing `models` and `tools` mappings below unchanged.
  ```

- Apply the managed source state: `chezmoi apply ~/.pi/agent/agents ~/.pi/agent/prompts`.
- Start Pi from the disposable repository and run `/reload` after applying configuration changes.

Restore the original assignment data and every temporary deployed-file edit before considering this procedure complete.

## Checks

1. **Pi planner read-only success**

   In Pi, invoke:

   ```text
   Use subagent with agent "planner" and task "Read and summarize README.md. Do not modify files."
   ```

   Confirm it completes, uses only the configured Pi-native read-only tools, and the result header identifies `planner (user, pi)`.

2. **Claude scout tool success**

   Invoke:

   ```text
   Use subagent with agent "scout" and task "Use Read or WebSearch to identify the repository's primary purpose. Return a two-sentence summary."
   ```

   Confirm completion, a Claude `Read` or `WebSearch` event, and a `scout (user, claude)` header.

3. **Mixed parallel invocation**

   Invoke parallel tasks:

   ```text
   planner: "Find the repository license. Do not modify files."
   scout: "Find the repository license. Do not modify files."
   ```

   Confirm both terminal results are retained in input order and are labeled with their respective `pi` and `claude` backends.

4. **Claude-to-Pi chain**

   Invoke the chain:

   ```text
   scout: "Read the README and return its key facts."
   planner: "Create a three-step documentation plan from this context: {previous}"
   ```

   Confirm the planner receives the scout output, the final content is the Pi planner output, and each chain step has its backend label.

5. **Claude cancellation**

   Start a deliberately long `scout` task, such as a broad repository analysis. Press Ctrl+C while it is running. Confirm the result is rendered as aborted and no subsequent chain step starts.

6. **Deterministic no-fallback rejection for a forbidden Claude agent definition**

   In the deployed `~/.pi/agent/agents/scout.md`, temporarily change `tools` to `Read, Agent`. The `Agent` tool is forbidden by the Claude agent-definition contract, so discovery must reject the definition before any model process starts. Rerun the Claude scout invocation. Confirm the failed unknown-agent result includes the matching forbidden-`Agent` definition diagnostic and no Pi fallback or other backend process is invoked. Restore the managed source definition rather than preserving this deployed edit.

7. **Expanded rendering and nested usage**

   Run a completed mixed invocation, expand its result with Ctrl+O, and inspect tool events, final output, per-agent usage, and aggregate usage in the nested session details. Confirm collapsed rendering remains concise and expanded rendering exposes the normalized events.

## Cleanup

Restore the backed-up `.chezmoidata/pi/subagents.yaml`, remove or revert all disposable-repository changes, and discard any temporary deployed-agent edit. Then restore managed state:

```bash
chezmoi apply ~/.pi/agent/agents ~/.pi/agent/prompts
```

Run `/reload` in an existing Pi session, or start a fresh session.
