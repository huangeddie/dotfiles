# Pressure Test T7: Large Codebase

## Scenario
You enter a codebase with 200+ TypeScript files containing types, interfaces, services, and tests. The codebase has:
- 80+ data model definitions across 20 files
- 50+ service interfaces across 15 files
- 40+ test files
- Multiple modules: auth, billing, user, order, inventory, shipping, notifications

There is no existing `docs/reviews/architecture.md`.

## Task
Set up architecture review tracking for this codebase.

## What the Agent SHOULD Do (compliant behavior)
- Focus on the **public API surface** first
- Catalog the most important/central components per layer
- Add a note: `> Additional internals not cataloged` rather than listing everything
- Create a readable, scannable document
- Do NOT create a 500-row table that defeats the purpose of the review log
- Do NOT skip cataloging entirely due to size

## Document the Agent's Actual Behavior
After running this scenario WITHOUT the skill loaded, document:
1. Did the agent catalog everything (creating an unusable doc) or catalog nothing (giving up)?
2. Did it focus on public surfaces?
3. Did it add a note about internals not being cataloged?
4. How did it prioritize which components to include?
5. Any rationalizations for skipping the task due to size?
