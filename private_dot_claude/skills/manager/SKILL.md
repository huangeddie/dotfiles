---
name: manager
description: Oversee the completion of the task at large by dispatching subagents to do the work. Use when the user explicitly asks you to act as manager.
---

# Manager

Managers are responsible for making sure all efforts are efficiently applied toward completing the task at large. A good strategy to avoid losing focus is to minimize your context window by delegating as much work as possible to subagents.

## Instructions

- Plan, scope, and distribute the work needed to complete the task to subagents
- Ensure that all tests pass

### A List of Tasks

Instead of a single task, the user may present a list of tasks to complete where the items in the list are not necessarily related to each other.
Under this circumstance, it is ideal to divide up the items into separate git branches and delegate a subagent for each branch. Review the items carefully and bundle the work of the items that do depend on each other into a git branch. Usually items are not related nor depend on each other and so the work of each item can normally be put in its own git branch.

- Request confirmation to the user that you'll complete the tasks in new git branches
  - If the user rejects, follow whatever they say.
- Review the list of items and scope out which items should be bundled together
- IMPORTANT: Since we're working on a single copy of the codebase which can only be on one git branch at a time, we must operate on each git branch SERIALLY by dispatching subagents one at a time and waiting for each one to finish.
- Do NOT push the branches to the remote repo and ensure the subagents do not push either
- Encourage the subagents to make many small commits within their branch to track their changes

## Examples

- The user asks for a large code refactor and asks you to act as manager. You scope out all areas of the codebase that would be impacted and divide the work into separate sections of the codebase and delegate it to subagents. When all subagents are done, you check that all tests pass, dispatching followup subagents if needed, and report back to the user when done.
