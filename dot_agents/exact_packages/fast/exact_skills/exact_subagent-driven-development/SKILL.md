---
name: subagent-driven-development
description: Use when the user asks to execute an implementation plan via pi orchestration (or asks for the `fast` variant of subagent-driven-development). Delegates the entire per-task loop (implementer + spec/quality reviews) to one `pi -p` call; the host caller composes the prompt, dispatches once, then runs a final code review via the Task tool. Do not auto-select over `superpowers:subagent-driven-development` — the user dictates which to use.
---

<!-- Sibling of superpowers:subagent-driven-development. Inverts the responsibility split: pi orchestrates per-task work; host caller is thin. -->

# Subagent-Driven Development (Fast)

Delegate the entire per-task implementation+review loop to one `pi -p` call. The host caller's job is to compose, dispatch once, and run a final code review.

**Core principle:** One pi call handles the inner loop; the host caller is the outer review gate.

## When to Use

Use this skill when the user asks for it by name (or asks for "the `fast` variant" / "pi-orchestrated" subagent-driven development). Otherwise prefer `superpowers:subagent-driven-development`. The user decides which orchestration mode fits the task — do not infer it from properties of the plan.

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

### 3. Final code review (outer)

Pi will already have run its own final whole-implementation reviewer at the end of the inner loop (per the upstream skill) and surfaced its findings in the summary's `notes`. After pi returns `ALL_DONE` (or `PARTIAL` with acceptable concerns), dispatch an **independent** final code reviewer via the host's native Task tool against the full branch diff:

- `BASE_SHA` = the commit before pi ran (capture this before dispatching pi)
- `HEAD_SHA` = current `HEAD`
- Use the `superpowers:requesting-code-review` template

This is the outer review on top of pi's inner reviews (per-task + pi's own final whole-implementation). Two layers run by independent agent stacks gives defense-in-depth. If the outer reviewer finds critical or important issues, surface them: either re-dispatch pi with targeted fix instructions or escalate to the human.

## Integration with the superpowers framework

This skill sits in the same workflow slot as `superpowers:subagent-driven-development`:

- **Before:** `superpowers:writing-plans` produces the plan this skill executes
- **Before:** `superpowers:using-git-worktrees` produces the isolated workspace pi commits into
- **After:** `superpowers:finishing-a-development-branch` handles merge / PR

The `pi-orchestrator-prompt.md` instructs pi to follow the superpowers TDD discipline (test-driven-development) and two-stage review (spec → quality) for each task at the inner pi-orchestrated layer.

## Red Flags

- **Inlining the plan body into the pi prompt.** Pass file paths; let pi read. Inlining defeats the "one short prompt" goal and burns shell-escape complexity on backticks and code fences in the plan.
- **Skipping the outer final code review.** Pi runs its own final reviewer at the inner layer; the host caller's Task-tool review is the outer gate. The two layers are independent — skipping the outer one collapses the defense-in-depth into one stack.
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
