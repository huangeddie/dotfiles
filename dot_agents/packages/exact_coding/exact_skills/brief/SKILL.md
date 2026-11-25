---
name: brief
description:
  Brief on the task(s) from the project's task tracker, and work with the user
  on the best way to complete them.
---

Project task trackers varies across workspaces. Most likely, the project tracker
is documented in the project's AGENTS.md file, otherwise the user should
specify.

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

## 3. Brainstorm

Brainstorm with the user.
