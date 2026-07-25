# Pi subagent backend manual QA

> **Manual QA only. Do not add this procedure to hooks or CI.**

## Prerequisites

- Authenticate both production CLIs: `pi` and `claude`.
- Use a trusted, disposable repository. These checks invoke production models and may read or modify files according to the selected agent tools.
- Before any command that can change runtime selection state, start a dedicated shell in the disposable repository and run this setup. Keep that shell open for all checks. It defines `${XDG_STATE_HOME:-$HOME/.local/state}/pi/subagents-profile`, backs up its exact prior contents or records its absence, and installs cleanup that restores that exact state rather than selecting a replacement profile:

  ```bash
  set -euo pipefail

  state_path="${XDG_STATE_HOME:-$HOME/.local/state}/pi/subagents-profile"
  state_backup="$(mktemp)"
  had_state=0
  qa_restored=0
  project_scout=".pi/agents/scout.md"
  project_scout_created=0
  project_agents_dir_created=0
  project_pi_dir_created=0

  if test -e "$state_path"; then
    test -f "$state_path" || {
      printf 'Refusing QA: state path is not a regular file: %s\n' "$state_path" >&2
      rm -f "$state_backup"
      exit 1
    }
    cp "$state_path" "$state_backup"
    had_state=1
  fi

  restore_qa_state() {
    if test "$qa_restored" -eq 1; then
      return
    fi

    if test "$project_scout_created" -eq 1; then
      rm -f "$project_scout"
    fi
    if test "$project_agents_dir_created" -eq 1; then
      rmdir .pi/agents 2>/dev/null || true
    fi
    if test "$project_pi_dir_created" -eq 1; then
      rmdir .pi 2>/dev/null || true
    fi

    if test "$had_state" -eq 1; then
      mkdir -p "$(dirname "$state_path")"
      cp "$state_backup" "$state_path"
      cmp -s "$state_backup" "$state_path"
    else
      rm -f "$state_path"
      test ! -e "$state_path"
    fi

    rm -f "$state_backup"
    qa_restored=1
  }
  trap restore_qa_state EXIT
  ```

- Only after that backup exists, confirm the deployed profile catalog and CLI. Preserve the initial status for the final exact-state check:

  ```bash
  pi-subagents list
  pre_qa_status="$(pi-subagents)"
  printf '%s\n' "$pre_qa_status"
  pi-subagents use claude
  pi-subagents use gpt
  ```

> **Production model checks are manual.** Run them only with authenticated CLIs in a disposable repository; do not run them automatically.

## Checks

1. **Missing state defaults to GPT.** Remove only the backed-up runtime selection path and confirm it is absent:

   ```bash
   rm -f "$state_path"
   test ! -e "$state_path"
   pi-subagents
   ```

   Confirm the status reports GPT as active. Invoke:

   ```text
   Use subagent with agent "planner", agentScope "user", and task "Read and summarize README.md. Do not modify files."
   ```

   Confirm the result is source `user`, backend `pi`, and model `openai-codex/gpt-5.6-terra`.

2. **Claude selection and worker tool event.** Run `pi-subagents use claude`, then confirm `pi-subagents` reports Claude as active. Invoke:

   ```text
   Use subagent with agent "scout" and task "Use Read or WebSearch to identify the repository's primary purpose. Return a two-sentence summary."
   ```

   Confirm the scout uses Claude. Then invoke a worker task that requires a permitted tool and confirm a Claude worker tool event is rendered.

3. **Profile snapshot is homogeneous for parallel and chain calls.** With one profile selected, invoke parallel scout and planner tasks and confirm every result uses that profile's backend. Invoke a scout-to-planner chain and confirm both steps use the same selected profile.

4. **A switch during a long chain affects only the next invocation.** Start a deliberately long chain under one selected profile. While it runs, switch with `pi-subagents use gpt` or `pi-subagents use claude`. Confirm every step in the running chain keeps its original profile snapshot; the next subagent tool invocation uses the newly selected profile.

5. **Project-local shadowing remains direct.** Select an explicit active profile, then create the complete project fixture without overwriting an existing file:

   ```bash
   pi-subagents use gpt
   test ! -e "$project_scout"
   if ! test -e .pi; then
     project_pi_dir_created=1
   fi
   if ! test -e .pi/agents; then
     project_agents_dir_created=1
   fi
   mkdir -p "$(dirname "$project_scout")"
   project_scout_created=1
   cat >"$project_scout" <<'EOF'
   ---
   name: scout
   description: Project-local direct-routing shadow fixture
   backend: claude
   model: haiku
   tools: Read
   ---

   You are the project shadow fixture. Read README.md and return exactly one sentence beginning with "PROJECT SHADOW:". Do not modify files.
   EOF
   ```

   Invoke the project shadow with exactly `agentScope: "both"`:

   ```text
   Use subagent with agent "scout", agentScope "both", and task "Follow the project scout instructions for README.md."
   ```

   Approve only the expected disposable project agent if Pi prompts. Confirm the result begins with `PROJECT SHADOW:` and reports source `project` and backend `claude`. The direct configured model selector must remain `haiku` (`--model haiku`); expanded usage may show the concrete model identifier returned by Claude. This proves the active GPT profile did not overlay direct project front matter.

   Remove the fixture with these concrete cleanup commands, then invoke the global role with exactly `agentScope: "user"`:

   ```bash
   rm -f "$project_scout"
   project_scout_created=0
   if test "$project_agents_dir_created" -eq 1; then
     rmdir .pi/agents
     project_agents_dir_created=0
   fi
   if test "$project_pi_dir_created" -eq 1; then
     rmdir .pi
     project_pi_dir_created=0
   fi
   ```

   ```text
   Use subagent with agent "scout", agentScope "user", and task "Read and summarize README.md in one sentence. Do not modify files."
   ```

   Confirm the result reports source `user`, backend `pi`, and model `openai-codex/gpt-5.6-luna`, proving the unshadowed global scout receives the active GPT profile.

6. **Corrupt state fails before a backend starts and CLI repair works.** Corrupt the same backed-up state path directly:

   ```bash
   mkdir -p "$(dirname "$state_path")"
   printf '%s\n' 'not-a-profile' >"$state_path"
   ```

   Invoke any configured global role with `agentScope: "user"` and confirm an actionable diagnostic identifies `$state_path` and instructs `pi-subagents use <profile>` before any Pi or Claude backend starts. Repair the token and confirm the active selection:

   ```bash
   pi-subagents use gpt
   pi-subagents | grep -q '^Active profile: gpt$'
   ```

7. **Claude cancellation and expanded rendering.** Select Claude and start a deliberately long scout task. Press Ctrl+C and confirm it renders as aborted. Run a completed invocation, expand it with Ctrl+O, and confirm the expanded result exposes normalized tool events, final output, per-agent usage, and aggregate usage while collapsed rendering remains concise.

8. **Cleanup restores exact prior state.** Remove or revert every disposable-repository change made by model tasks. Then run the cleanup function and disable the trap only after it succeeds:

   ```bash
   restore_qa_state
   trap - EXIT
   test "$(pi-subagents)" = "$pre_qa_status"
   ```

   The function removes the project fixture and restores the exact bytes backed up from `$state_path`, or restores the exact prior absence of that path. Confirm no production-model QA artifact remains.

## Cleanup

Normal completion uses check 8. On interruption or early shell exit, the `EXIT` trap runs the same exact-state restoration and project-fixture cleanup automatically. Never clean up by merely selecting GPT or Claude: preserve the state file's exact prior contents or absence. Remove or revert any other disposable-repository changes made by production models. Do not add this manual procedure to automated hooks or CI.
