---
name: subagent-driven-development
description: Use when executing an implementation plan AND speed/cost matters more than per-task strong-model judgment — for plans with mostly-independent, mechanical, well-specified tasks. Delegates the entire per-task loop (implementer + cheap-model spec/quality reviews) to one `pi -p` orchestrator call; the host caller composes the prompt, dispatches once, then runs a final strong-model code review via the Task tool. Trigger this only when the speed/cost differentiator matters — route plans needing strong-model per-task judgment to `superpowers:subagent-driven-development` instead.
---

<!-- Sibling of superpowers:subagent-driven-development. Inverts the responsibility split: pi orchestrates per-task work; host caller is thin. -->

# Subagent-Driven Development (Fast)

Delegate the entire per-task implementation+review loop to one `pi -p` call. The host caller's job is to compose, dispatch once, and run a final strong-model code review.

**Core principle:** One pi call handles the inner loop; the host caller is the outer review gate.

## When to Use

Use this skill instead of `superpowers:subagent-driven-development` when:
- You have an implementation plan with mostly-independent tasks
- The tasks are mechanical and well-specified (no architectural judgment needed per task)
- Speed/cost matters — pi runs cheap/fast models for the inner loop
- A single strong-model code review on the final branch is a sufficient quality gate

Use `superpowers:subagent-driven-development` instead when:
- You want the strong model to judge every per-task subagent report
- The tasks involve architectural choices or ambiguous specs that need per-task judgment
- The cost of strong-model orchestration is acceptable

## The Process

Three steps. That is the whole skill.

### 1. Compose the pi prompt

Gather three pieces of information:

- **Plan path** — `docs/superpowers/plans/<plan>.md` or wherever the plan lives
- **Spec path** — `docs/superpowers/specs/<spec>.md`, or the literal string `(none)` if no spec exists
- **Working directory** — repo root or worktree (use `superpowers:using-git-worktrees` to set up an isolated worktree before invoking this skill)

Read `./pi-orchestrator-prompt.md` (this skill's directory). Substitute three placeholders in it:

- `{{PLAN_PATH}}` → the plan path
- `{{SPEC_PATH}}` → the spec path (or `(none)`)
- `{{WORKDIR}}` → the working directory absolute path

Write the substituted content to `$TMPDIR/fast-sdd-<plan-slug>.md`. Pi reads the plan and spec from disk — do not inline the plan body into the prompt. Inlining bloats the prompt and forces shell-escape complexity for no gain.

### 2. Dispatch pi once

```bash
pi -p "$(cat $TMPDIR/fast-sdd-<plan-slug>.md)"
```

One call. Capture stdout. Pi returns when every task in the plan is either complete or it has hit a hard block.

The last block of stdout is the structured summary, delimited by:

```
=== PI SDD SUMMARY ===
status: ALL_DONE | PARTIAL | BLOCKED
tasks:
  - id: 1
    title: <task title>
    status: DONE | DONE_WITH_CONCERNS | BLOCKED
    commits: [<sha>, ...]
    files: [<path>, ...]
    concerns: <text or empty>
  - ...
notes: <free-form orchestrator notes>
=== END PI SDD SUMMARY ===
```

Parse this block. If overall `status: BLOCKED` or any task is `BLOCKED`, **escalate to the human** — surface the concerns and stop. Do not silently re-dispatch.

### 3. Final code review (strong model)

After pi returns `ALL_DONE` (or `PARTIAL` with acceptable concerns), dispatch a final code reviewer via the host's native Task tool against the full branch diff:

- `BASE_SHA` = the commit before pi ran (capture this before dispatching pi)
- `HEAD_SHA` = current `HEAD`
- Use the `superpowers:requesting-code-review` template

This is the strong-model gate on top of pi's cheap-model internal per-task reviews. Pi's internal reviews are padding — they catch obvious issues cheaply — but they are not the actual quality bar. If the final reviewer finds critical or important issues, surface them: either re-dispatch pi with targeted fix instructions or escalate to the human.

## Integration with the superpowers framework

This skill sits in the same workflow slot as `superpowers:subagent-driven-development`:

- **Before:** `superpowers:writing-plans` produces the plan this skill executes
- **Before:** `superpowers:using-git-worktrees` produces the isolated workspace pi commits into
- **After:** `superpowers:finishing-a-development-branch` handles merge / PR

The `pi-orchestrator-prompt.md` instructs pi to follow the superpowers TDD discipline (test-driven-development) and two-stage review (spec → quality) for each task, just at the inner pi-orchestrated layer instead of the host layer.

## Red Flags

- **Inlining the plan body into the pi prompt.** Pass file paths; let pi read. Inlining defeats the "one short prompt" goal and burns shell-escape complexity on backticks and code fences in the plan.
- **Skipping the final code review.** Pi's internal reviews use cheap models — they're padding, not the gate. The strong-model Task-tool review at the end is the actual gate. Skipping it means no strong-model has audited the work.
- **Silently re-dispatching after BLOCKED.** If pi blocked, something needs human input. Re-dispatching the same prompt produces the same block.
- **Dispatching pi on a dirty working tree.** Pi commits as it goes; on a dirty tree those commits will tangle with your uncommitted work. Use a worktree or stash first.
- **Running on `main`/`master` without explicit user consent.** Pi commits aggressively. Always use a feature branch.
- **Inlining the contents of `pi-orchestrator-prompt.md` without doing the placeholder substitution.** Pi will see literal `{{PLAN_PATH}}` strings and have no idea what plan to execute.

## Recovery from pi BLOCKED

Escalate to the human. Surface:
- Which task blocked
- Pi's BLOCKED report (concerns, what it tried)
- What's already committed (so the human knows the partial state — pi may have completed several tasks before blocking)

Do not fall back to `superpowers:subagent-driven-development` automatically. Let the human decide whether to switch orchestration mode, expand the plan, or change the approach.
