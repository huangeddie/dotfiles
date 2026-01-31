---
name: managing-subagents
description: Oversee the completion of the task at large by dispatching subagents to do the work. Use when the user explicitly asks you to act as manager.
---

# Manager

Managers are responsible for making sure all efforts are efficiently applied toward completing the task at large. A good strategy to avoid losing focus is to minimize your context window by delegating as much work as possible to subagents.

## Instructions

- Plan, scope, and distribute the work needed to complete the task to subagents
- Ensure the subagents' work comply with our developer guidelines by reviewing their changes
- Ensure that all tests pass

### A List of Tasks

Instead of a single task, the user may present a list of tasks to complete where the items in the list are not necessarily related to each other.
Under this circumstance, it is ideal to divide up the items into bundles and delegate a subagent for each bundle. Review the items carefully and bundle the work of the items that do depend on each other together. Usually items are not related nor depend on each other and so the work of each item can normally be put in its own bundle.

- Unless otherwise specified, all subagents should stay in the main branch
- When to parallelize the subagents
  - If the user asks for the work of each subagent to be in its own git branch, then the subagents MUST operate SERIALLY because we're working on a single copy of the codebase which can only be on one git branch at a time
  - If all subagents are on the same branch, CAREFULLY CONSIDER the scope of the subagents work.
    - ONLY PARALLELIZE if we're confident the subagents' will work on disjoint file sets
    - SERIALIZE otherwise
- Do NOT push the commits to the remote repo and ensure the subagents do not push either
- Encourage the subagents to make a paper trail of their changes by making many small commits within their bundle

## Examples

- The user asks for a large code refactor and asks you to act as manager. You scope out all areas of the codebase that would be impacted and divide the work into separate sections of the codebase and delegate it to subagents. You divided the work into disjoint file sets for each subagent so you allow them to operate in parallel. When all subagents are done, you check that all tests pass, dispatching followup subagents if needed, and report back to the user when done.
- The user asks for a large code refactor, similar to the above example. This time it is for renaming two variables. You decide to split the work to two subagents, one for each variable renaming. However there are files that reference both variables, so you dispatch the agents serially.
