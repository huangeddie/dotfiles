# Architecture Reviews: Layer Reviews + Confidence Scale

**Skill:** `maintaining-architecture-reviews`
**Date:** 2026-05-10

## Motivation

Two shortcomings in the current skill:

1. **No way to review a whole layer at once.** A reviewer who has just done a holistic pass on the Domain Model layer is forced to update every component row individually, which is tedious and conflates "I scanned the layer" with "I deeply reviewed each component."

2. **Status enum is binary and time-coupled.** The current `🟢 current | 🟡 stale | 🔴 missing | ⚪ unreviewed` set conflates two unrelated dimensions: *was this reviewed* and *was the review recent*. It carries no information about the reviewer's actual judgment of the component's quality. We want a richer signal that captures the reviewer's confidence in the component, decoupled from the passage of time.

## Design

### 1. Status values

Replace the current 4-value enum with:

- **Confidence tiers (set only by an explicit review):**
  - `1 Broken`
  - `2 Fragile`
  - `3 Rough`
  - `4 Adequate`
  - `5 Solid`
  - `6 Polished`
  - `7 Exemplary`
- **Meta states:**
  - `⚪ Unreviewed` — default for new components; no review has been recorded.
  - `🔴 Missing` — component no longer exists in code; preserves history. Set only on user request.

The numeric prefix is required; the tier name follows it (e.g., `4 Adequate`). The status column renders as plain text — no bars, colors, or other decorations for the 1-7 tiers. Emoji is retained for `Unreviewed` and `Missing` to signal that they are categorically different from a confidence rating.

Staleness is removed entirely. Time-based decay is not tracked. Readers compare `Last Reviewed` against `Last Modified` to judge whether they trust the rating.

### 2. Layer-level reviews

Each `## Layer: X` section may contain an optional `#### Layer Review Notes` subsection at the top, before any category subsections. Format mirrors the existing per-category Review Notes blockquote pattern:

```markdown
## Layer: Domain Model

#### Layer Review Notes
> **2026-05-10 — Eddie (5 Solid):** Trust the shapes; interfaces feel weakly typed but no urgent issues.
> **2025-12-01 — Alice (4 Adequate):** Initial scan after refactor; consider extracting Address.

### Data Models
| Component | File | Definition | Last Reviewed | Reviewer | Last Modified | Status |
| User      | ...  | ...        | ...           | ...      | ...           | ⚪ Unreviewed |
```

Properties:

- **Independent of per-component status.** A layer review records the reviewer's holistic confidence in the layer. It does not modify any component rows.
- **Append-only.** Each layer review adds one new blockquote line. Old entries remain for history.
- **Section is omitted when empty.** No `#### Layer Review Notes` header until the first layer review is recorded.
- **Rating is required.** Every entry must include a confidence tier in parentheses after the reviewer name. A free-text comment after the colon is recommended but optional.
- **Same pattern applies to Cross-Cutting Concerns subsections.** A `## Cross-Cutting Concerns` subsection may contain its own `#### Layer Review Notes` block. The name "Layer Review Notes" is kept uniform across both contexts to avoid vocabulary churn.

### 3. Document header

Drop two header fields:

- `> Review cadence: 30 days` — staleness is gone, so cadence is no longer a doc-level concept. Cadence becomes an organizational decision the team makes outside the doc.
- `> Last full scan: YYYY-MM-DD` — there is no longer a formal scan workflow (see §5).

The retained header:

```markdown
# Architecture Review Log

> **To collaborators:** When updating this document, use the `maintaining-architecture-reviews` skill.
```

### 4. Component table columns

Unchanged: `Component | File | Definition | Last Reviewed | Reviewer | Last Modified | Status`. The Status column now holds a confidence tier or a meta-state instead of a freshness indicator.

### 5. Workflow changes

**Step 5 (Record Reviews)** gains two distinct modes:

- *Component review.* User says e.g. "reviewed `User` — 5". Update that row's `Last Reviewed`, `Reviewer`, and `Status`. Optional comment goes into the category's `#### Review Notes` blockquote.
- *Layer review.* User says e.g. "reviewed Domain Model layer — 5, interfaces feel weak". Append one blockquote line to the layer's `#### Layer Review Notes`. Do not touch any component rows.

**Step 6 (Detect Stale & Missing) is removed.** Replaced with implicit handling:

- No formal scan workflow exists.
- The skill does not proactively verify that doc rows match the codebase.
- If a discrepancy is noticed incidentally — during cataloging, while answering a question, while preparing to record a review — the skill flags it and asks the user how to proceed. The user decides the resolution (mark `🔴 Missing`, add a renamed-to row, leave alone, etc.).
- `🔴 Missing` is only set on explicit user request.

**Rating elicitation.** When the user says "reviewed X" without specifying a tier, the skill asks which tier (1–7) before recording. It never guesses. If the user declines to rate, nothing is recorded — a review without a confidence tier is not a review under this scheme.

### 6. Rules

1. **Never delete rows** — preserve history.
2. **Don't invent reviews or ratings** — new components are `⚪ Unreviewed`. Only set a confidence tier when the user explicitly reviews.
3. **Auto-update `Last Modified`, not `Last Reviewed` or `Status`** — code changes never alter a confidence rating.
4. **Brainstorm layers before writing** — never guess layer structure without user approval.
5. **Use exactly 7 columns** — `Component | File | Definition | Last Reviewed | Reviewer | Last Modified | Status`.
6. **Review Notes & Layer Review Notes are simple blockquotes** — no tables, no findings sections, no action items.
7. **Layer reviews are independent** — they record the reviewer's holistic confidence and never modify component rows.
8. **Always elicit a tier** — when the user says "reviewed X" without a number, ask which tier (1–7). Don't guess; don't record without one.
9. **Flag discrepancies, don't fix them silently** — when a component looks gone or moved, ask the user how to handle it.

### 7. Common mistakes (skill body table)

| Excuse | Reality |
|--------|---------|
| "I'll set up a comprehensive review system" | The doc tracks reviews, not performs them. |
| "Code changes are basically a review" | `Last Modified` ≠ `Last Reviewed`. Modifications never change `Status`. |
| "Missing component should be moved/deleted" | Deleting loses history. Mark `🔴 Missing` only on user request. |
| "I'll assign a reviewer since I'm creating the doc" | Cataloging ≠ reviewing. Mark `⚪ Unreviewed`. |
| "It's been a while, I'll knock down the rating" | Time doesn't lower confidence. Only the reviewer can change a tier, by reviewing again. |
| "Reviewer didn't say a number, I'll pick `4 Adequate`" | Never invent a tier. Ask. |
| "A layer review means I should also bump every component" | Layer reviews and component reviews are independent. |
| "More structure makes the doc better" | Format is intentional. Don't add columns or sections. |
| "I'll reorganize layers to improve architecture" | Propose, don't implement. |

### 8. Red flags — STOP and re-read this skill

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

## Files affected

- `dot_agents/exact_skills/maintaining-architecture-reviews/SKILL.md` — schema, workflow, rules, common mistakes, red flags, example block.
- `dot_agents/exact_skills/maintaining-architecture-reviews/example-architecture.md` — replace status emojis with confidence tiers, add a `#### Layer Review Notes` block to at least one layer, drop the cadence and last-full-scan header lines.

## Out of scope

- A separate "Layer Review" table (rejected during brainstorming in favor of blockquote notes for consistency with existing per-category Review Notes).
- Color-coded status rendering for the 1-7 tiers (rejected in favor of plain text).
- Automated scan tooling for missing-component detection (rejected in favor of incidental flagging).
- Cross-component aggregation (e.g., layer rating computed from component ratings) — layer ratings are independent reviewer judgments, not aggregates.
- Migration tooling for existing architecture review docs in the wild — the skill operates on whatever doc state it finds; users updating an old doc will simply see the new conventions applied going forward.
