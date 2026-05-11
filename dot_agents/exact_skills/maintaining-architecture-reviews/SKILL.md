---
name: maintaining-architecture-reviews
description: Use when cataloging, reviewing, or tracking the architectural health of a codebase — data models, interfaces, contracts, and unit tests across modules and abstraction levels
---

# Maintaining Architecture Reviews

## Overview

Maintain a persistent `docs/reviews/architecture.md` document that catalogs your codebase's architectural components — data models, interfaces, and unit tests — organized by abstraction layers. Track review history and capture the reviewer's confidence in each component.

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
- `### Data Models`, `### Interfaces`, `### Unit Tests` — component categories within a layer.
- Component tables with exactly 7 columns: `Component | File | Definition | Last Reviewed | Reviewer | Last Modified | Status`.
- `#### Review Notes` — optional dated/signed comments below each category table:
  `> **YYYY-MM-DD — Name:** comment text`
- `#### Layer Review Notes` — optional dated/signed comments at the top of each layer (and each cross-cutting concern), one blockquote line per review:
  `> **YYYY-MM-DD — Name (TIER):** comment text`
- `## Cross-Cutting Concerns` — concepts spanning layers.

### Status values

The `Status` column holds either a confidence tier (`1 Broken` through `7 Exemplary`) or a meta state (`⚪ Unreviewed`, `🔴 Missing`). Full definitions of each tier live in the document's own **Rating Scale** section — see the template in step 1 of the Workflow. Reviewers reference that section in the doc itself; the skill writes it there once on initialization rather than duplicating it.

The confidence tier reflects the reviewer's judgment of the component's quality. It is not coupled to time: a rating persists until someone reviews again. Readers compare `Last Reviewed` against `Last Modified` to judge whether they still trust the rating.

## Workflow

### 1. Initialization
If `docs/reviews/architecture.md` doesn't exist, create it from the template and run exploration. The header includes the rating scale so reviewers can reference it inline while rating — they shouldn't have to leave the doc to remember what `4 Adequate` means:

```markdown
# Architecture Review Log

> **To collaborators:** When updating this document, use the `maintaining-architecture-reviews` skill.

## Rating Scale

When reviewing a component or layer, pick the tier that best matches your current confidence. Tiers describe quality and trust, not effort spent — a component you barely touched can still be `6 Polished` if it earned the rating.

| Tier | Name | What it means |
|------|------|---------------|
| 1 | Broken | Doesn't work, violates its contract, or is fundamentally the wrong shape. Treat as a known liability. |
| 2 | Fragile | Works in the happy path but breaks under pressure. Hidden coupling, missing error handling, or tests that pass for the wrong reasons. |
| 3 | Rough | Functional but awkward. Confusing naming, leaky abstractions, or known design flaws. Usable, but easy to misuse. |
| 4 | Adequate | Meets baseline expectations. No glaring issues; trustworthy for current use. Not yet refined. |
| 5 | Solid | Well-designed and trustworthy. Reasonable boundaries, clear naming, tests cover the important cases. The default "good" rating. |
| 6 | Polished | Refined and pleasant to work with. Clean abstractions, thorough tests, robust to edge cases. |
| 7 | Exemplary | A model for the rest of the codebase. Other components should be measured against it. |

**Meta states** (not confidence tiers):
- `⚪ Unreviewed` — default for new components; no review has happened yet.
- `🔴 Missing` — component no longer exists in code; preserved for history. Set only on explicit user request.
```

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
Under approved layers, add components to tables. New components start as `⚪ Unreviewed`. Cataloging is not reviewing — never set a confidence tier just because you added the row.

### 5. Record Reviews

Two distinct modes:

**Component review.** When the user says e.g. "reviewed `User` — 5":
- Update that row's `Last Reviewed` to today, `Reviewer` to the user's name, `Status` to the tier they specified.
- If the user includes a comment, append it to the category's `#### Review Notes`:
  `> **YYYY-MM-DD — {Reviewer}:** {comment}`

**Layer review.** When the user says e.g. "reviewed Domain Model layer — 5, interfaces feel weak":
- Append one blockquote line to the layer's `#### Layer Review Notes`:
  `> **YYYY-MM-DD — {Reviewer} ({TIER}):** {comment}`
- Do not touch any component rows. A layer review records the reviewer's holistic confidence; it does not propagate down.
- The same pattern applies under `## Cross-Cutting Concerns` subsections.

**If the user says "reviewed X" without specifying a tier, ask which tier (1–7) before recording anything.** Never guess. If they decline to rate, record nothing — a review without a confidence tier is not a review under this scheme.

### 6. Handle Discrepancies
The skill does not proactively re-verify rows. If a discrepancy surfaces incidentally — during cataloging, while answering a question, while preparing a review — flag it to the user and ask how they want to proceed. Possible resolutions include marking the row `🔴 Missing`, adding a new row for a renamed component, or leaving it alone. The user decides; the skill never silently fixes.

### 7. Propose Cross-Cutting Concerns
Identify patterns across layers. Present to user. Never reorganize without approval.

## Rules

1. **Never delete rows** — preserve history. Mark `🔴 Missing` in the same table when the user confirms a component is gone.
2. **Don't invent reviews or ratings** — new components are `⚪ Unreviewed`. Only set a confidence tier when the user explicitly reviews.
3. **Auto-update `Last Modified`, not `Last Reviewed` or `Status`** — code changes never alter a confidence rating. Time alone does not lower confidence; only a new review does.
4. **Brainstorm layers before writing** — never guess layer structure without user approval.
5. **Use exactly 7 columns** — `Component | File | Definition | Last Reviewed | Reviewer | Last Modified | Status`. No extra columns, no extra sections.
6. **Review Notes & Layer Review Notes are simple blockquotes** — no tables, no findings sections, no action items.
7. **Layer reviews are independent** — they record holistic confidence and never modify component rows.
8. **Always elicit a tier** — when the user says "reviewed X" without a number, ask which tier (1–7). Don't guess; don't record without one.
9. **Flag discrepancies, don't fix them silently** — when a component looks gone or moved, ask the user how to handle it.

## Common Mistakes

| Excuse | Reality |
|--------|---------|
| "I'll set up a comprehensive review system" | The doc tracks reviews, not performs them. Simple tables only. |
| "Code changes are basically a review" | `Last Modified` ≠ `Last Reviewed`. Modifications never change `Status`. |
| "Missing component should be moved/deleted" | Deleting loses history. Mark `🔴 Missing` only on user request. |
| "I'll assign a reviewer since I'm creating the doc" | Cataloging ≠ reviewing. Mark `⚪ Unreviewed`. |
| "It's been a while, I'll knock down the rating" | Time doesn't lower confidence. Only a fresh review changes a tier. |
| "Reviewer didn't say a number, I'll pick `4 Adequate`" | Never invent a tier. Ask. |
| "A layer review means I should also bump every component" | Layer reviews and component reviews are independent. |
| "More structure makes the doc better" | The format is intentional. Don't add columns or sections. |
| "I'll reorganize layers to improve architecture" | Propose, don't implement. |
| "Findings need action items and tracking" | Review Notes are simple blockquotes. No extra tables or sections. |

## Red Flags — STOP and Re-read This Skill

- Setting a confidence tier without an explicit review from the user
- Letting code modifications change `Status`
- Cascading a layer review down to component rows
- Silently marking a component `🔴 Missing` without asking the user
- Deleting rows from the architecture review doc
- Updating `Last Reviewed` when only code was modified
- Writing the doc without brainstorming layers with the user
- Creating bullet lists, findings sections, or severity ratings instead of simple tables
- Inventing review dates, reviewer names, or confidence tiers
- Reorganizing layers without user approval
- Adding extra columns, ADR registry, compliance tracker, or dependency graphs
- Skipping cataloging because the codebase is "too big"

## Example

```markdown
# Architecture Review Log

> **To collaborators:** When updating this document, use the `maintaining-architecture-reviews` skill.

## Layer: Domain Model

#### Layer Review Notes

> **2024-03-22 — Eddie (5 Solid):** Shapes are trustworthy; some interfaces feel weakly typed but no urgent issues.
> **2024-01-15 — Eddie (4 Adequate):** First pass after the refactor.

### Data Models

| Component | File | Definition | Last Reviewed | Reviewer | Last Modified | Status |
|-----------|------|-----------|---------------|----------|---------------|--------|
| User | src/types.ts | `interface User` | 2024-01-15 | Eddie | 2024-03-20 | 5 Solid |
| Order | src/types.ts | `interface Order` | 2024-02-01 | Alice | 2024-03-18 | 6 Polished |
| Payment | src/payments.ts | `interface Payment` | - | - | 2024-03-19 | ⚪ Unreviewed |

#### Review Notes

> **2024-01-15 — Eddie:** Consider extracting Address into separate type.
> **2024-02-01 — Alice:** ✅ Extracted Address. Added nullable fields.

### Interfaces

| Component | File | Definition | Last Reviewed | Reviewer | Last Modified | Status |
|-----------|------|-----------|---------------|----------|---------------|--------|
| IUserService | src/services.ts | `interface IUserService` | 2024-01-15 | Eddie | 2024-03-22 | 3 Rough |

### Unit Tests

| Component | File | Test Scope | Last Reviewed | Reviewer | Last Modified | Status |
|-----------|------|-----------|---------------|----------|---------------|--------|
| Domain Model | src/types.test.ts | Full suite | 2024-02-01 | Alice | 2024-03-21 | 5 Solid |
```
