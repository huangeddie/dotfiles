---
name: review-architecture
description:
  Use when cataloging, reviewing, or tracking the architectural health of a
  codebase — data models, interfaces, contracts, and unit tests across modules
  and abstraction levels
---

# Maintaining Architecture Reviews

## Overview

Maintain a small directory of Markdown files under `docs/architecture/`
that catalogs your codebase's architectural components — data models,
interfaces, and unit tests — organized by abstraction layers. A root
`docs/architecture/README.md` acts as the dashboard. Track review
history and capture the reviewer's confidence in each component.

**Core principle:** A reviewed codebase is an understood codebase. Unreviewed
components are unowned components.

**Personal log, not collaboration.** This skill assumes a single user
maintaining their own review log. There is no reviewer field anywhere — date is
sufficient for attribution.

## When to Use

- Entering a new codebase (initial cataloging)
- Before major refactoring
- After significant code changes
- Periodic architecture health checks (monthly/quarterly)

## Document Schema

### File layout

```
docs/architecture/README.md                           # root: index + Rating Scale
docs/architecture/AGENTS.md                           # folder instruction: use review-architecture here
docs/architecture/layers/<layer-slug>.md              # one per layer
docs/architecture/cross-cutting/<concern-slug>.md     # one per cross-cutting concern
```

- Filenames are stable kebab-case slugs of the layer or concern name (e.g.
  `domain-model.md`, `user-management.md`). No rating or date in filenames —
  that data lives in each file's frontmatter.
- Layer order is defined by the root index's TOC; the directory's alphabetical
  order is incidental.
- New layer or concern → create file + register it in the root index. Renamed
  layer → file rename + index update + frontmatter `layer:` + H1 all updated
  together.

See `example/` next to this skill for a complete miniature: a root index plus
two layer files and a cross-cutting concern file.

### Root index shape (`docs/architecture/README.md`)

The root file holds two things readers don't want to chase across files: the
Rating Scale (so they can interpret tiers inline) and the dashboard of per-layer
/ per-concern summaries.

```markdown
# Architecture Review Log

## Rating Scale

...full Rating Scale section — see template in Workflow §1...

## Layers

### [Domain Model](layers/domain-model.md) — 5 Solid (reviewed 2024-03-22)

> Shapes are trustworthy; some interfaces feel weakly typed but no urgent
> issues.

### [Application Services](layers/application-services.md) — ⚪ Unreviewed

## Cross-Cutting Concerns

### [User Management](cross-cutting/user-management.md) — 4 Adequate (reviewed 2024-03-22)

> Spans: `User` (Domain Model) + `IUserService` (Domain Model) + `AuthService`
> (Application Services)
>
> End-to-end user flow holds together but the boundary between IUserService and
> AuthService is muddled.
```

- Each layer / concern gets an H3 with: link to file, current rating, last
  reviewed date.
- Below the H3, an optional single blockquote with the most recent layer
  review's `note` (mirrored from the file's frontmatter). Omit the blockquote if
  no note.
- An unreviewed layer shows just the H3 — no blockquote.
- Cross-cutting concerns include a `Spans:` blockquote naming the
  cross-referenced components. If a note also exists, it follows the `Spans:`
  line separated by an empty `>` line.
- The root index does NOT contain Layer Review Notes history — only the most
  recent layer review is kept anywhere. New layer reviews overwrite the previous
  one.

### Per-layer file shape

```markdown
---
layer: Domain Model
rating: 5 Solid
reviewed: 2024-03-22
note:
  Shapes are trustworthy; some interfaces feel weakly typed but no urgent
  issues.
---

# Domain Model

### Data Models

- `interface User` — 5 Solid

  - File: `src/types.ts`
  - Reviewed: 2024-01-15
  - Modified: 2024-03-20

- `interface Payment` — ⚪ Unreviewed
  - File: `src/payments.ts`
  - Reviewed: —
  - Modified: 2024-03-19

#### Review Notes

> **2024-01-15:** Consider extracting Address into separate type.
> **2024-02-01:** ✅ Extracted Address. Added nullable fields.

### Interfaces

...

### Unit Tests

...
```

**Frontmatter** is a layer-level snapshot. There is no history — each layer
review overwrites the previous one.

- `layer`: human-readable layer name. Must match the H1 and the root index
  entry.
- `rating`: current confidence tier (e.g. `5 Solid`) or meta state
  (`⚪ Unreviewed`).
- `reviewed`: ISO date of the most recent layer review, or `null` if never
  reviewed.
- `note`: optional one-line comment from the most recent layer review. Omit the
  field if no note.

**Body:**

- H1 = layer name.
- `### Data Models`, `### Interfaces`, `### Unit Tests` — three category
  subsections, in that order. Empty category → `_None yet._` italic line.
- Component bullets follow the shape below.
- `#### Review Notes` (per category, optional) holds component-level dated
  comments: `> **YYYY-MM-DD:** comment`.
- **No Layer Review Notes section.** Layer review state lives only in the
  frontmatter (mirrored to the root index).

**Cross-cutting concern files** follow the same shape with two additions:

- Frontmatter includes an `identified: YYYY-MM-DD` field recording when the
  concern was first surfaced.
- Body has a `> Spans: ...` blockquote immediately under the H1, listing
  cross-referenced components.
- Component bullets include a `Layer:` sub-bullet identifying each component's
  primary layer.

### Component bullet shape

**Data Models & Interfaces.** The bullet title is the type's definition (a code
declaration in backticks, or a short prose description when there's no single
declaration). Status follows after `—`. Four metadata sub-bullets, always
present, with `—` for empty:

```markdown
- `interface User` — 5 Solid
  - File: `src/types.ts`
  - Reviewed: 2024-01-15
  - Modified: 2024-03-20
```

**Unit Tests.** Title is the test class name in bold. The `Scope:` sub-bullet
replaces what would be the definition.

```markdown
- **DomainModelTests** — 5 Solid
  - Scope: Full suite for User/Order/Payment
  - File: `src/types.test.ts`
  - Reviewed: 2024-02-01
  - Modified: 2024-03-21
```

Uniform shape matters: it lets readers visually scan a category for missing
reviews. Always include every metadata sub-bullet, even if its value is `—`.

### Status values

The status segment (after `—` in a bullet title or H3) holds either a confidence
tier (`1 Broken` through `7 Exemplary`) or a meta state (`⚪ Unreviewed`,
`🔴 Missing`). Full definitions live in the root file's **Rating Scale** section
— see the template in Workflow §1.

The confidence tier reflects the reviewer's judgment of the component's quality.
It is not coupled to time: a rating persists until someone reviews again.
Readers compare `Reviewed` against `Modified` to judge whether they still trust
the rating.

### Component identifiers

The user references a component by a short identifier (e.g. "reviewed
`ClothingItem` — 5"). The identifier is a substring of the bullet title: for
data models/interfaces, it's the type name inside the definition; for tests,
it's the bolded class name. Locate the bullet by searching for the identifier
within the relevant category list under the relevant layer file.

## Source of Truth & Sync

All layer-level review state lives in the per-layer file's frontmatter. The root
index's H3 line + optional note blockquote is a denormalized cache of that
frontmatter.

| Data                                                      | Lives in                                                 | Source of truth                                                                        |
| --------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Layer's current rating, last reviewed date, optional note | Per-layer frontmatter (mirrored in root H3 + blockquote) | **Per-layer frontmatter**                                                              |
| Component bullets + Component Review Notes                | Per-layer file body only                                 | Per-layer file                                                                         |
| Cross-cutting `Spans:` line                               | Both per-concern body and root H3 block                  | Derived from the per-concern file's component bullets (each has a `Layer:` sub-bullet) |

Sync rule: when the skill is performing any operation on a layer and notices the
root H3 or note blockquote disagrees with that layer's frontmatter, it fixes the
root from the frontmatter and tells the user. There is no background
reconciliation; the skill corrects only what it touches.

## Workflow

### 1. Initialization

If `docs/architecture/README.md` doesn't exist, initialize the architecture
review docs from the repository root:

```bash
path/to/review-architecture/scripts/init-architecture-docs.sh
```

The script creates:

- `docs/architecture/README.md` from the template below
- `docs/architecture/AGENTS.md`, which instructs agents to use the
  `review-architecture` skill for changes under `docs/architecture/`
- Empty `docs/architecture/layers/` and
  `docs/architecture/cross-cutting/` directories

No layer files exist until layers are approved (§3).

```markdown
# Architecture Review Log

## Rating Scale

When reviewing a component or layer, pick the tier that best matches your
current confidence. Tiers describe quality and trust, not effort spent — a
component you barely touched can still be `6 Polished` if it earned the rating.

**Confidence tiers** (set only by an explicit review):

- **1 Broken** — Doesn't work, violates its contract, or is fundamentally the
  wrong shape. Treat as a known liability.
- **2 Fragile** — Works in the happy path but breaks under pressure. Hidden
  coupling, missing error handling, or tests that pass for the wrong reasons.
- **3 Rough** — Functional but awkward. Confusing naming, leaky abstractions, or
  known design flaws. Usable, but easy to misuse.
- **4 Adequate** — Meets baseline expectations. No glaring issues; trustworthy
  for current use. Not yet refined.
- **5 Solid** — Well-designed and trustworthy. Reasonable boundaries, clear
  naming, tests cover the important cases. The default "good" rating.
- **6 Polished** — Refined and pleasant to work with. Clean abstractions,
  thorough tests, robust to edge cases.
- **7 Exemplary** — A model for the rest of the codebase. Other components
  should be measured against it.

**Meta states** (not confidence tiers):

- `⚪ Unreviewed` — default for new components; no review has happened yet.
- `🔴 Missing` — component no longer exists in code; preserved for history. Set
  only on explicit user request.

## Layers

_No layers yet._

## Cross-Cutting Concerns

_None yet._
```

### 2. Explore (Read-Only First)

Find data models: types, structs, classes, protocols, schemas, DTOs. Focus on
public/exported. Find interfaces: public functions, methods, handlers,
contracts. Find unit tests: test files grouped by layer.

### 3. Propose Abstraction Layers

Before writing any layer file, present a layer proposal to the user:

- Propose 3-6 layers based on discovered patterns
- Explain what goes in each layer
- Wait for user approval, modification, or rejection
- Do NOT write any layer file until layers are approved

### 4. Catalog

For each approved layer, create
`docs/architecture/layers/<layer-slug>.md` with frontmatter
(`rating: ⚪ Unreviewed`, `reviewed: null`, no `note`) and an H1 matching the
layer name. Then add the three category subsections — even if empty (use
`_None yet._`). Register the file in the root index's `## Layers` section as an
H3 link.

Add discovered components as bullets using the **Component bullet shape**. New
components start with status `⚪ Unreviewed` and `—` for `Reviewed`. Cataloging
is not reviewing — never set a confidence tier just because you added the entry.

### 5. Record Reviews

Two distinct modes:

**Component review.** When the user says e.g. "reviewed `User` — 5":

- Find the per-layer file containing the bullet (search by identifier within the
  relevant category list).
- Update its status segment to the tier they specified and set `Reviewed:` to
  today.
- If the user includes a comment, append it to the category's
  `#### Review Notes`: `> **YYYY-MM-DD:** {comment}`
- The root index does NOT change on a component review.

**Layer review.** When the user says e.g. "reviewed Domain Model layer — 5,
interfaces feel weak":

- Overwrite the per-layer file's frontmatter: set `rating`, `reviewed`, and
  `note` (or omit `note` if no comment was given). No history is kept.
- Then overwrite the root index's H3 line for that layer (rating + date) and its
  note blockquote (or remove the blockquote if no note).
- Do not touch any component bullets — a layer review records the reviewer's
  holistic confidence; it does not propagate down.
- Same pattern under `## Cross-Cutting Concerns`.

**If the user says "reviewed X" without specifying a tier, ask which tier (1–7)
before recording anything.** Never guess. If they decline to rate, record
nothing — a review without a confidence tier is not a review under this scheme.

### 6. Handle Discrepancies

The skill does not proactively re-verify entries. If a discrepancy surfaces
incidentally — during cataloging, while answering a question, while preparing a
review — flag it to the user and ask how they want to proceed. Possible
resolutions include changing the bullet's status to `🔴 Missing`, adding a new
bullet for a renamed component, or leaving it alone. The user decides; the skill
never silently fixes.

### 7. Propose Cross-Cutting Concerns

Identify patterns across layers. Present to user. On approval, create
`docs/architecture/cross-cutting/<slug>.md` and register it in the
root's `## Cross-Cutting Concerns` section. Never reorganize layers without
approval.

## Rules

1. **Never delete bullets** — preserve history. Change the status segment to
   `🔴 Missing` when the user confirms a component is gone.
2. **Don't invent reviews or ratings** — new components are `⚪ Unreviewed`.
   Only set a confidence tier when the user explicitly reviews.
3. **Auto-update `Modified`, not `Reviewed` or status** — code changes never
   alter a confidence rating. Time alone does not lower confidence; only a new
   review does.
4. **Brainstorm layers before writing** — never guess layer structure without
   user approval.
5. **Use the bullet shape exactly — no tables for components** — every component
   bullet has the title (definition for data models/interfaces, bold class name
   for tests) followed by `— {status}`, with four nested metadata sub-bullets:
   `File`, `Reviewed`, `Modified` (data models/interfaces) or `Scope`, `File`,
   `Reviewed`, `Modified` (tests). Empty values are `—`, not blank.
6. **Single-user log — no reviewer field anywhere** — no `Reviewer` sub-bullet
   on components, no `reviewer` key in frontmatter, no name segment in
   blockquotes. Date is sufficient for attribution.
7. **Only the most recent layer review is kept** — layer review overwrites the
   previous one (rating, date, note). No history blockquotes.
8. **A layer review writes to BOTH places** — the per-layer file's frontmatter
   AND the root index's H3 + note blockquote. The frontmatter is the source of
   truth; if they diverge, the root is corrected from the frontmatter.
9. **Layer reviews are independent from component reviews** — a layer review
   never modifies component bullets, and a component review never modifies the
   root index.
10. **Always elicit a tier** — when the user says "reviewed X" without a number,
    ask which tier (1–7). Don't guess; don't record without one.
11. **Flag discrepancies, don't fix them silently** — when a component looks
    gone or moved, ask the user how to handle it.
12. **Component Review Notes are simple blockquotes** — no tables, no findings
    sections, no action items.

## Common Mistakes

| Excuse                                                    | Reality                                                                                                    |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| "I'll set up a comprehensive review system"               | The doc tracks reviews, not performs them. Simple bullets only.                                            |
| "Code changes are basically a review"                     | `Modified` ≠ `Reviewed`. Modifications never change status.                                                |
| "Missing component should be moved/deleted"               | Deleting loses history. Mark `🔴 Missing` only on user request.                                            |
| "I'll assign a reviewer since I'm creating the doc"       | No reviewer field exists. The skill is a single-user log.                                                  |
| "It's been a while, I'll knock down the rating"           | Time doesn't lower confidence. Only a fresh review changes a tier.                                         |
| "Reviewer didn't say a number, I'll pick `4 Adequate`"    | Never invent a tier. Ask.                                                                                  |
| "A layer review means I should also bump every component" | Layer reviews and component reviews are independent.                                                       |
| "I'll append this layer review to a history list"         | Only the most recent layer review is kept. Overwrite the previous one.                                     |
| "I updated the per-layer file; the root index can wait"   | Both writes happen in the same operation. The root is the dashboard — stale dashboard = useless dashboard. |
| "Tables would make this scannable"                        | Tables don't wrap; the doc becomes unreadably wide. Bullets are intentional.                               |
| "I'll encode the rating + date in the filename"           | Filenames are stable kebab-case slugs. Rating + date live in frontmatter.                                  |
| "I'll skip the `—` placeholders to save space"            | Uniform shape across bullets is the point. Always include every metadata field.                            |
| "I'll reorganize layers to improve architecture"          | Propose, don't implement.                                                                                  |
| "Findings need action items and tracking"                 | Review Notes are simple blockquotes. No extra structure.                                                   |

## Red Flags — STOP and Re-read This Skill

- Setting a confidence tier without an explicit review from the user
- Letting code modifications change a component's status
- Cascading a layer review down to component bullets
- Silently marking a component `🔴 Missing` without asking the user
- Deleting bullets from any per-layer file
- Updating `Reviewed` when only code was modified
- Writing layer files without brainstorming layers with the user
- Re-introducing tables for component lists, or adding findings sections,
  severity ratings, or other extra structure
- Re-introducing a Reviewer field anywhere (component sub-bullets, frontmatter,
  blockquotes)
- Re-introducing a Layer Review Notes history (appending blockquotes instead of
  overwriting)
- Encoding rating or date in filenames
- Updating the per-layer frontmatter without also updating the root index (or
  vice versa)
- Omitting metadata sub-bullets to keep bullets short
- Inventing review dates or confidence tiers
- Reorganizing layers without user approval
- Adding ADR registries, compliance trackers, dependency graphs, or other scope
  creep
- Skipping cataloging because the codebase is "too big"

## Example

See the `example/` directory next to this skill for a complete miniature in the
new shape: a root `architecture/README.md`, `architecture/AGENTS.md`, per-layer
files under `architecture/layers/`, and cross-cutting concern files under
`architecture/cross-cutting/`. Refer to it whenever the structure of a file is
unclear.
