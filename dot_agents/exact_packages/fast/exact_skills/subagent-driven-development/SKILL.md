---
name: subagent-driven-development
description: Use when executing an implementation plan and you want to delegate the entire per-task orchestration (implementer + per-task reviews) to a single `pi` orchestrator call. The host caller composes one prompt, makes one `pi -p` call, then runs a final strong-model code review on the resulting branch.
---

<!-- Sibling of superpowers:subagent-driven-development. Inverts the responsibility split: pi orchestrates per-task work; host caller is thin. -->

# Subagent-Driven Development (Fast)

Delegate the entire per-task implementation+review loop to one `pi -p` call. The host caller's job is to compose, dispatch once, and run a final strong-model code review.

**Core principle:** One pi call handles the inner loop; the host caller is the outer review gate.

## When to Use

Use this skill instead of `superpowers:subagent-driven-development` when:
- You have an implementation plan with mostly-independent tasks
- You want to delegate the whole per-task loop (implementer + spec review + code-quality review) to a cheap/fast orchestrator
- A final strong-model code review on the whole branch is sufficient quality gate

Use `superpowers:subagent-driven-development` instead when:
- You want the strong model to dispatch and judge every per-task subagent
- The tasks need per-task judgment from the orchestrator (architectural choices, ambiguous specs)

## The Process

Three steps. That is the whole skill.

### 1. Compose the pi prompt

You need three pieces of information:

- **Plan path** — `docs/superpowers/plans/<plan>.md` (or wherever the plan lives)
- **Spec path** — `docs/superpowers/specs/<spec>.md` (if a spec exists for context)
- **Working directory** — repo root or worktree

Write a short prompt to `$TMPDIR/fast-sdd-<plan-slug>.md` that contains:

1. The literal contents of `./pi-orchestrator-prompt.md` (this skill's directory)
2. Resolved values for the `{{PLAN_PATH}}`, `{{SPEC_PATH}}`, and `{{WORKDIR}}` placeholders

Pi will read the plan and spec files itself — do not inline the plan text.

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

Parse this block. If `status: BLOCKED` or any task is `BLOCKED`, **escalate to the human** — surface the concerns and stop. Do not silently re-dispatch.

### 3. Final code review (strong model)

After pi returns `ALL_DONE` (or `PARTIAL` with acceptable concerns), dispatch a final code reviewer via the host's native Task tool against the full branch diff:

- `BASE_SHA` = the commit before pi ran
- `HEAD_SHA` = current `HEAD`
- Use the `superpowers:requesting-code-review` template

This is the strong-model gate on top of pi's cheap-model internal per-task reviews. If the final reviewer finds critical or important issues, surface them — either re-dispatch pi with targeted fix instructions or escalate to the human.

## Integration with the superpowers framework

This skill sits in the same workflow slot as `superpowers:subagent-driven-development`:

- **Before:** `superpowers:writing-plans` produces the plan this skill executes
- **After:** `superpowers:finishing-a-development-branch` handles merge / PR

The `pi-orchestrator-prompt.md` instructs pi to follow the superpowers TDD discipline (test-driven-development) and two-stage review (spec → quality) for each task, just at the inner pi-orchestrated layer instead of the host layer.

## Red Flags

- **Inlining the plan body into the pi prompt.** Pass file paths; let pi read. Inlining defeats the "one short prompt" goal and burns shell-escape complexity.
- **Skipping the final code review.** Pi's internal reviews use cheap models — they're padding, not the gate. The strong-model Task-tool review at the end is the actual gate.
- **Silently re-dispatching after BLOCKED.** If pi blocked, something needs human input.
- **Dispatching pi while the working tree is dirty.** Pi will commit on a dirty tree and tangle its commits with yours. Verify clean tree first.
- **Running on `main`/`master` without explicit user consent.** Same red flag as upstream.

## Recovery from pi BLOCKED

Escalate to the human. Surface:
- Which task blocked
- Pi's BLOCKED report (concerns, what it tried)
- What's already committed (so the human knows the partial state)

Do not fall back to `superpowers:subagent-driven-development` automatically — let the human decide whether to switch orchestration mode, expand the plan, or change the approach.
