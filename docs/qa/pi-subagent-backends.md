# Pi subagent backend manual QA

> **Manual QA only. Do not add this procedure to hooks or CI.**

## Prerequisites

- Authenticate both production CLIs: `pi` and `claude`.
- Use a trusted, disposable repository. These checks invoke production models and may read or modify files according to the selected agent tools.
- Record the profile active before QA so cleanup can restore it.
- Confirm the deployed profile catalog and CLI:

  ```bash
  pi-subagents list
  pi-subagents
  pi-subagents use claude
  pi-subagents use gpt
  ```

> **Production model checks are manual.** Run them only with authenticated CLIs in a disposable repository; do not run them automatically.

## Checks

1. **Missing state defaults to GPT.** Remove only the runtime selection state file, run `pi-subagents`, and confirm it reports GPT as active. Invoke:

   ```text
   Use subagent with agent "planner" and task "Read and summarize README.md. Do not modify files."
   ```

   Confirm the planner uses the GPT/Pi assignment.

2. **Claude selection and worker tool event.** Run `pi-subagents use claude`, then confirm `pi-subagents` reports Claude as active. Invoke:

   ```text
   Use subagent with agent "scout" and task "Use Read or WebSearch to identify the repository's primary purpose. Return a two-sentence summary."
   ```

   Confirm the scout uses Claude. Then invoke a worker task that requires a permitted tool and confirm a Claude worker tool event is rendered.

3. **Profile snapshot is homogeneous for parallel and chain calls.** With one profile selected, invoke parallel scout and planner tasks and confirm every result uses that profile's backend. Invoke a scout-to-planner chain and confirm both steps use the same selected profile.

4. **A switch during a long chain affects only the next invocation.** Start a deliberately long chain under one selected profile. While it runs, switch with `pi-subagents use gpt` or `pi-subagents use claude`. Confirm every step in the running chain keeps its original profile snapshot; the next subagent tool invocation uses the newly selected profile.

5. **Project-local shadowing remains direct.** In the disposable repository, create a project-local `scout` with direct front matter and invoke it with `agentScope: both`. Confirm it retains its own direct front matter. Confirm the global user `scout` remains runtime-profiled when the project-local shadow is absent.

6. **Corrupt state fails before a backend starts and CLI repair works.** Directly replace the runtime state token with an invalid value. Invoke any configured global role and confirm an actionable selection diagnostic appears before any Pi or Claude backend starts. Run `pi-subagents use gpt`, then confirm GPT selection is restored.

7. **Claude cancellation and expanded rendering.** Select Claude and start a deliberately long scout task. Press Ctrl+C and confirm it renders as aborted. Run a completed invocation, expand it with Ctrl+O, and confirm the expanded result exposes normalized tool events, final output, per-agent usage, and aggregate usage while collapsed rendering remains concise.

8. **Cleanup restores prior state.** Restore the profile that was active before QA and remove all disposable project-agent files. Confirm `pi-subagents` reports the restored profile.

## Cleanup

Restore the profile active before QA, remove or revert all disposable-repository changes (including project-local agent files), and confirm no production-model QA artifact remains. Do not add this manual procedure to automated hooks or CI.
