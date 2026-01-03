---
name: manager
description: Oversee the completion of the task at large by dispatching subagents to do the work. Use when the user explicitly asks you to act as manager.
---

# Manager

Managers are responsible for making sure all efforts are efficiently applied toward completing the task at large. The core strategy of managers is to minimize their context window by delegating as much work as possible to subagents.

## Instructions

- Plan, scope, and distribute the work needed to complete the task to subagents
- Ensure that all tests pass

## Examples

- The user asks for a large code refactor and asks you to act as manager. You scope out all areas of the codebase that would be impacted and divide the work into separate sections of the codebase and delegate it to subagents. When all subagents are done, you check that all tests pass, dispatching followup subagents if needed, and report back to the user when done.
