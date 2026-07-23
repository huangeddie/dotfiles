# Pi subagent backend manual QA

> **Manual QA only. Do not add this procedure to hooks or CI.**

## Prerequisites

- Apply the managed source state: `chezmoi apply ~/.pi/agent/extensions/subagent ~/.pi/agent/agents ~/.pi/agent/prompts`.
- Authenticate both production CLIs: `pi` and `claude`.
- Use a trusted, disposable repository. These checks invoke production models and may read or modify files according to the selected agent tools.
- Start Pi from that repository after each configuration change.

Restore every temporary file created below, then rerun the `chezmoi apply` command above before considering this procedure complete.

## Checks

1. **GPT scout read-only success**

   In Pi, invoke:

   ```text
   Use subagent with agent "gpt-scout" and task "Read the repository README and summarize its first heading. Do not modify files."
   ```

   Confirm it completes, uses only the configured Pi-native read-only tools, and the result header identifies `gpt-scout (user, pi)`.

2. **Claude scout tool success**

   Invoke:

   ```text
   Use subagent with agent "claude-scout" and task "Use Read or WebSearch to identify the repository's primary purpose. Return a two-sentence summary."
   ```

   Confirm completion, a Claude `Read` or `WebSearch` event, and a `claude-scout (user, claude)` header.

3. **Mixed parallel invocation**

   Invoke parallel tasks:

   ```text
   gpt-scout: "Find the repository license. Do not modify files."
   claude-scout: "Find the repository license. Do not modify files."
   ```

   Confirm both terminal results are retained in input order and are labeled with their respective `pi` and `claude` backends.

4. **Claude-to-GPT chain**

   Invoke the chain:

   ```text
   claude-scout: "Read the README and return its key facts."
   gpt-planner: "Create a three-step documentation plan from this context: {previous}"
   ```

   Confirm the planner receives the scout output, the final content is the GPT planner output, and each chain step has its backend label.

5. **Claude cancellation**

   Start a deliberately long `claude-scout` task, such as a broad repository analysis. Press Ctrl+C while it is running. Confirm the result is rendered as aborted and no subsequent chain step starts.

6. **No fallback after invalid or denied Claude tool configuration**

   In the deployed `~/.pi/agent/agents/claude-scout.md`, temporarily change `tools` to an invalid or denied Claude tool definition. Rerun the Claude scout invocation. Confirm it reports a Claude failure or permission denial, never invokes Pi as a fallback, and retains `claude` in the result header. Restore the managed source definition rather than preserving this deployed edit.

7. **Expanded rendering and nested usage**

   Run a completed mixed invocation, expand its result with Ctrl+O, and inspect tool events, final output, per-agent usage, and aggregate usage in the nested session details. Confirm collapsed rendering remains concise and expanded rendering exposes the normalized events.

## Cleanup

Remove or revert all disposable-repository changes and any temporary deployed agent edits. Then restore the managed state:

```bash
chezmoi apply ~/.pi/agent/extensions/subagent ~/.pi/agent/agents ~/.pi/agent/prompts
```
