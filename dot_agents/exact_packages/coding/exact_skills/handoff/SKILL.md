---
name: handoff
description:
  "Write a handoff prompt for another agent and copy it to clipboard."
---

# Handoff

Write a clipboard-ready prompt directing another agent to carry out a specific
task.

Use when the user asks for `handoff <task>`, "write a handoff", "delegate this",
or wants a prompt for another agent.

## Workflow

1. Identify the task from the user text. If the user gives only a short label,
   infer from the current repo, recent discussion, branch name, linked issue/PR,
   docs, and obvious nearby context.
2. Gather enough context to write a useful handoff: repo/product identity,
   relevant issue/PR/branch names, likely modules, constraints, and known
   symptoms.
3. Write a standalone prompt for a fresh agent.
4. Copy the full prompt to the clipboard.
5. Final reply: terse confirmation with the task title. Do not paste the full
   prompt unless the user asks.

## Handoff Prompt Rules

The prompt must:

- Be a work order: state the task and tell the agent to do it.
- Give the agent only the orientation it needs to start working: which repo,
  which code, which constraints.
- Not ask the agent to debate the premise, re-litigate scope, or seek approval
  before starting. The decision to do this task is already made.
- Still tell the agent to stop and surface it if the task turns out to be
  already done, impossible, or built on a broken assumption.
- Assume the agent starts in the repo, a parent directory, a workspace
  directory, or a home directory and can find the repo itself.
- Use portable anchors instead: repo owner/name, product/module names, issue/PR
  URLs, branch names, package/plugin names, public symbols, command names,
  config keys, exact error text, docs titles, and search terms.
- Include enough context for the receiving agent to get the right repo,
  boundary, and desired outcome.
- Include constraints, non-goals, validation expectations, and the desired
  output shape.
- Tell the receiving agent to re-check live repo/GitHub/CI state where relevant.
- Tell the receiving agent not to push, merge, close issues/PRs, label, or post
  public comments unless the handoff explicitly asks for it.

## Prompt Template

Use this shape by default:

```text
Task: <short task title>

Context:
- <portable repo/product context>
- <what triggered this task>
- <known current state, branch/issue/PR names or URLs if relevant>
- <important constraints and ownership boundaries>

To orient yourself:
- Find the right repository from the current directory, a parent directory, or the usual workspace.
- Read the local agent/repo instructions.
- Read the relevant code, docs, tests, and linked issue/PR state; re-check live repo/GitHub/CI state where it matters.

Do this:
- <what to implement>
- <expected behavior>
- <non-goals>

Stop and report back only if the task is already done, is blocked, or rests on an assumption you find to be false. Otherwise proceed.

Validation:
- <focused tests/checks/live proof expected>
- <what evidence should be included>
- <what is explicitly not required>

Output:
- Summarize what you changed and the exact proof run.
- Do not push, merge, close issues/PRs, label, or post public comments unless explicitly told.
```

## Clipboard

On macOS:

```sh
pbcopy < /tmp/handoff-prompt.txt
```

Use a temp file or pipe. Avoid inline shell quoting for prompts containing
backticks, `$`, quotes, or user text.

If `pbcopy` is unavailable, use the obvious platform clipboard tool (`wl-copy`,
`xclip`, `clip.exe`) or print the prompt and say clipboard copy was unavailable.

## Quality Bar

- No invented facts. Mark reviewed facts as such only after checking them.
- Enough context for a fresh agent to orient; no giant brain dump.
- First real instruction to the receiving agent: the task itself.
