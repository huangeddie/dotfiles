---
name: maintaining-architecture-reviews
description: Use when cataloging, reviewing, or tracking the architectural health of a codebase — data models, interfaces, contracts, and unit tests across modules and abstraction levels
---

# Maintaining Architecture Reviews

## Overview

Maintain a persistent `docs/reviews/architecture.md` document that catalogs your codebase's architectural components — data models, interfaces, and unit tests — organized by abstraction layers. Track review history, detect stale components, and capture review notes.

**Core principle:** A reviewed codebase is an understood codebase. Unreviewed components are unowned components.

## When to Use

- Entering a new codebase (initial cataloging)
- Before major refactoring
- After significant code changes
- Periodic architecture health checks (monthly/quarterly)
- Onboarding a new team member to the architecture

## Document Schema

`docs/reviews/architecture.md` follows this convention:

- `## Layer: X` — abstraction layer sections. Brainstorm layer names with the user before writing.
- `### Data Models`, `### Interfaces`, `### Unit Tests` — component categories
- Tables with exactly 7 columns: Component | File | Definition | Last Reviewed | Reviewer | Last Modified | Status
- Status: 🟢 current | 🟡 stale | 🔴 missing | ⚪ unreviewed
- `#### Review Notes` — optional dated/signed comments below each category table:
  `> **YYYY-MM-DD — Name:** comment text`
- `## Cross-Cutting Concerns` — concepts spanning layers

## Workflow

### 1. Initialization
If `docs/reviews/architecture.md` doesn't exist, create it from the template and run exploration.

### 2. Explore (Read-Only First)
Find data models: types, structs, classes, protocols, schemas, DTOs. Focus on public/exported.
Find interfaces: public functions, methods, handlers, contracts.
Find unit tests: test files grouped by layer.

### 3. Propose Abstraction Layers
Before writing to the doc, present a layer proposal to the user:
- Propose 3-6 layers based on discovered patterns
- Explain what goes in each layer
- Wait for user approval, modification, or rejection
- Do NOT write the doc until layers are approved

### 4. Catalog
Under approved layers, add components to tables. Mark new components as ⚪ unreviewed.

### 5. Record Reviews
When the user says "reviewed X":
- Update `Last Reviewed` to today's date
- Update `Reviewer` to user's name
- If user includes a comment, add to `#### Review Notes`:
  `> **YYYY-MM-DD — {Reviewer}:** {comment}`
- Recalculate Status

### 6. Detect Stale & Missing
Stale: `Last Reviewed` exceeds cadence → 🟡.
Missing: component in doc but not in code → 🔴.
Never delete rows — preserve history.

### 7. Propose Cross-Cutting Concerns
Identify patterns across layers. Present to user. Never reorganize without approval.

## Rules

1. **Never delete rows** — mark 🔴 missing in the SAME table.
2. **Don't invent reviews** — new components are ⚪ unreviewed. Only update `Last Reviewed` when user explicitly says "reviewed."
3. **Auto-update `Last Modified`, not `Last Reviewed`** — code changes ≠ reviews.
4. **Brainstorm layers before writing** — never guess layer structure without user approval.
5. **Use exactly 7 columns** — Component | File | Definition | Last Reviewed | Reviewer | Last Modified | Status. No extra columns, no extra sections.
6. **Review Notes are simple blockquotes** — `> **YYYY-MM-DD — Name:** text`. No tables, no action items, no findings sections.

## Common Mistakes

| Excuse | Reality |
|--------|---------|
| "I'll set up a comprehensive review system" | The doc tracks reviews, not performs them. Simple tables only. |
| "Code changes are basically a review" | `Last Modified` ≠ `Last Reviewed`. Never conflate. |
| "Missing component should be moved/deleted" | Deleting loses history. Mark 🔴 missing in the SAME table. |
| "I'll assign a reviewer since I'm creating the doc" | Creating the doc ≠ reviewing components. Mark ⚪ unreviewed. |
| "Yellow feels right for reviewed-with-issues" | 🟡 stale = exceeds cadence. Has nothing to do with findings. |
| "More structure makes the doc better" | The table format is intentional. Don't add columns or sections. |
| "I'll reorganize layers to improve architecture" | Never reorganize without user approval. Propose, don't implement. |
| "Adding a component means I'm reviewing it" | Cataloging ≠ reviewing. Mark new components ⚪ unreviewed. |
| "Findings need action items and tracking" | Review Notes are simple blockquotes. No extra tables or sections. |

## Red Flags — STOP and Re-read This Skill

- Deleting rows from the architecture review doc
- Updating `Last Reviewed` when only code was modified
- Writing the doc without brainstorming layers with the user
- Creating bullet lists, findings sections, or severity ratings instead of simple tables
- Inventing review dates or reviewer names
- Reorganizing layers without user approval
- Adding extra columns, ADR registry, compliance tracker, or dependency graphs
- Skipping cataloging because the codebase is "too big"

## Example

```markdown
# Architecture Review Log

> **To collaborators:** When updating this document, use the `maintaining-architecture-reviews` skill.
> Last full scan: 2024-03-22
> Review cadence: 30 days

## Layer: Domain Model

### Data Models

| Component | File | Definition | Last Reviewed | Reviewer | Last Modified | Status |
|-----------|------|-----------|---------------|----------|---------------|--------|
| User | src/types.ts | `interface User` | 2024-01-15 | Eddie | 2024-03-20 | 🟡 stale |
| Order | src/types.ts | `interface Order` | 2024-02-01 | Alice | 2024-03-18 | 🟢 current |

#### Review Notes

> **2024-01-15 — Eddie:** Consider extracting Address into separate type.
> **2024-02-01 — Alice:** ✅ Extracted Address. Added nullable fields.

### Interfaces

| Component | File | Definition | Last Reviewed | Reviewer | Last Modified | Status |
|-----------|------|-----------|---------------|----------|---------------|--------|
| IUserService | src/services.ts | `interface IUserService` | 2024-01-15 | Eddie | 2024-03-22 | 🟡 stale |

### Unit Tests

| Component | File | Test Scope | Last Reviewed | Reviewer | Last Modified | Status |
|-----------|------|-----------|---------------|----------|---------------|--------|
| Domain Model | src/types.test.ts | Full suite | 2024-02-01 | Alice | 2024-03-21 | 🟢 current |

## Cross-Cutting Concerns

### User Management (identified 2024-03-22)
> Spans layers: `User` (Domain Model) + `IUserService` (Domain Model)

| Component | File | Definition | Layer | Last Reviewed | Reviewer | Last Modified | Status |
|-----------|------|-----------|-------|---------------|----------|---------------|--------|
| User | src/types.ts | `interface User` | Domain Model | 2024-01-15 | Eddie | 2024-03-20 | 🟡 stale |
```
