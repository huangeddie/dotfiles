---
name: dispatch
description:
  Dispatch one interactive coding agent per task from the project's task
  tracker, each in its own terminal session, so the user can scope each task
  with its agent separately.
---

Project task trackers varies across workspaces. Most likely, the project tracker
is documented in the project's AGENTS.md file, otherwise the user should
specify.

Terminal multiplexers also vary across workspaces and the term "terminal
session" also varies, but we primarily use two:

- Rex
  - "terminal session" => `tab`
- Herdr
  - "terminal session" => `space`

**Scope:** This skill only reads tasks and opens terminal sessions. It does not
implement, complete, reschedule, or edit tasks. Each dispatched agent owns its
own task from there.

## 1. Get the selection from the user

The user MUST say which tasks to work on. Examples:

- A priority threshold: "p3 and higher" means p1, p2 and p3.
- A section: "everything in UI".
- Named tasks, labels, or ID

If the request names no selection, ask for one. Do not assume "all tasks".

## 2. Read the tasks

For each matching task, collect:

- the content and description
- the section and priority
- the ID
- subtasks
- comments, if any

## 3. Write one brief per task

Write each brief to a fresh temporary directory, for example from `mktemp -d`.
Do not write briefs inside the repository.

Each brief contains:

1. **The protocol.** Use this text as is:

   > You own one task from the project tracker. The user will discuss the
   > details with you in this tab. Brief yourself on the proejct. Then ask the
   > user your clarifying questions one at a time, each with a recommended
   > answer. Do not edit code until you and the user agree on scope. When you
   > start implementing, use the `workspace` skill to create your own workspace
   > and work there.

2. **The task.** Include its content, description, section, priority, Todoist
   ID, subtasks and comments.
3. **Decisions already made.** If this conversation already settled any details
   of the task with the user, list them as settled. The agent must not ask about
   them again.
4. **Starting pointers.** Name the files, code or docs you already found that
   matter, so the agent doesn't search for them again. Do not add a design of
   your own that the user has not approved.

If a task is vague enough to need design work, such as a new feature with no
clear behavior, tell its agent to brainstorm the design with the user before
writing a spec.

## 4. Open one terminal session per task

For each task, pick an available agent harness at random, unless the user names
a CLI. Most common agent harnesses are

- Antigravity
- Claude Code
- Codex
- Jetski
- Pi

When the agent exits, the tab drops into a login shell instead of closing.

## 5. Verify and report

After a few seconds, capture each new terminal session. Confirm that the agent
started and is working on its brief. If an agent failed to start, report it. Do
not reopen it without telling the user.

Report the result as a table of tab names, tasks and CLIs. Note any agent whose
brief contains settled decisions, and any agent told to start with a design
session. Give the path of the brief directory.
