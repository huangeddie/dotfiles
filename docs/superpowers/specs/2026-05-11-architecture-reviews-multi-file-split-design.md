# Architecture Reviews — Multi-File Split

**Status:** Approved (pending spec self-review + user review)
**Date:** 2026-05-11
**Skill affected:** `maintaining-architecture-reviews`

## Problem

The `maintaining-architecture-reviews` skill produces a single `docs/reviews/architecture.md`. In active use (e.g. the Siyi iOS project, 923 lines), that single file is too long to skim. Scrolling through one giant doc to locate one layer is the dominant pain. A previous refactor solved table-width by switching to bullets; this design solves file-length by splitting per layer.

## Goals

- Per-layer files so skimming any one layer is a single short file.
- A root index that acts as the dashboard — see all layers' current ratings at a glance.
- Use YAML frontmatter to give each per-layer file a structured, machine-readable layer-level snapshot.
- Stay a single-user personal review log. No multi-user collaboration features.

## Non-Goals

- Encoding rating or date in filenames (considered, then rejected: stable filenames are simpler and frontmatter + the index already provide the dashboard).
- Migrating to a database or non-Markdown format.
- Automating reviews. The doc still tracks reviews; it does not perform them.
- Multi-user attribution. No `reviewer` field anywhere.
- **Tracking layer review history.** Only the most recent layer review is kept. New layer review overwrites the previous one (rating, date, optional note). Component-level Review Notes are unaffected — they are still per-category dated comments.

## Directory Layout

```
docs/reviews/architecture.md                                  # root: index + Rating Scale + Layer Review Notes
docs/reviews/architecture/domain-model.md
docs/reviews/architecture/ai-provider-layer.md
docs/reviews/architecture/ai-application-layer.md
docs/reviews/architecture/persistence-and-local-services.md
docs/reviews/architecture/presentation-swiftui.md
docs/reviews/architecture/cross-cutting-user-management.md
```

- Filenames are stable kebab-case slugs of the layer or concern name. No rating, no date in filenames.
- One file per layer. One file per cross-cutting concern.
- Layer order is defined by the root index's TOC. Filesystem order (alphabetical) is incidental.
- New layer or concern → create file + register in root index. Renamed layer → file rename + index update.

## Per-Layer File Shape

```markdown
---
layer: Domain Model
rating: 5 Solid
reviewed: 2024-03-22
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

- **DomainModelTests** — 5 Solid
  - Scope: Full suite
  - File: `src/types.test.ts`
  - Reviewed: 2024-02-01
  - Modified: 2024-03-21
```

**Frontmatter:** layer-level snapshot only. There is no history — each layer review overwrites the previous one.
- `layer`: human-readable layer name (must match the H1 and the root index entry).
- `rating`: current confidence tier string (e.g. `5 Solid`) or meta state (`⚪ Unreviewed`).
- `reviewed`: ISO date of the most recent layer review, or `null` if never reviewed.
- `note`: optional one-line comment from the most recent layer review. Empty string or absent if none.

**Body:**
- H1 = layer name.
- `### Data Models`, `### Interfaces`, `### Unit Tests` — same category structure as today.
- Component bullets keep the existing shape, but with **four** metadata sub-bullets instead of five (no `Reviewer`):
  - Data Models & Interfaces: `File`, `Reviewed`, `Modified`.
  - Unit Tests: `Scope`, `File`, `Reviewed`, `Modified`.
- Empty values still render as `—` so the shape is uniform across reviewed and unreviewed bullets.
- `#### Review Notes` per category lose the name segment: `> **YYYY-MM-DD:** comment`.
- **No `#### Layer Review Notes` section in this file.** Layer review history lives in the root index.

**Cross-cutting concern files** follow the same shape with two additions:
- Frontmatter includes an `identified: YYYY-MM-DD` field recording when the concern was first surfaced.
- Body has a `> Spans:` blockquote immediately under the H1, listing the cross-referenced components (e.g. `> Spans: User (Domain Model) + IUserService (Domain Model) + AuthService (Application Services)`).
- Component bullets include the `Layer:` sub-bullet (as today, to identify which layer each component primarily belongs to).

## Root `architecture.md` Shape

```markdown
# Architecture Review Log

> When updating this document, use the `maintaining-architecture-reviews` skill.

## Rating Scale

...full Rating Scale section, unchanged from current skill template...

## Layers

### [Domain Model](architecture/domain-model.md) — 5 Solid (reviewed 2024-03-22)

> Shapes are trustworthy; some interfaces feel weakly typed but no urgent issues.

### [AI Provider Layer](architecture/ai-provider-layer.md) — ⚪ Unreviewed

...

## Cross-Cutting Concerns

### [User Management](architecture/cross-cutting-user-management.md) — 4 Adequate (reviewed 2024-03-22)

> Spans: `User` (Domain Model) + `IUserService` (Domain Model) + `AuthService` (Application Services)
>
> End-to-end user flow holds together but the boundary between IUserService and AuthService is muddled.
```

- The root file is the dashboard.
- Each layer / concern gets an H3 with: link to file, current rating, last reviewed date.
- Below the H3, an optional single blockquote with the most recent layer review's `note` (mirrored from frontmatter). Omitted if no note.
- An unreviewed layer shows just the H3 — no blockquote.
- Cross-cutting concerns include a `Spans:` blockquote naming the cross-referenced components (preserved from current schema). If a note is also present, it follows the `Spans:` line separated by `>` (empty blockquote line).

## Source of Truth & Sync

All layer-level review state lives in the per-layer file's frontmatter. The root index's H3 line + optional note blockquote is a denormalized cache of that frontmatter, kept for dashboard convenience.

| Data | Lives in | Source of truth |
|------|----------|-----------------|
| Current rating, last reviewed date, optional note | Per-layer frontmatter (mirrored in root H3 + blockquote) | **Per-layer frontmatter** |
| Component bullets + Component Review Notes | Per-layer file only | Per-layer file |
| Cross-cutting `Spans:` line | Both per-concern body and root H3 block | Derived from the per-concern file's component bullets (each has a `Layer:` sub-bullet) |

The skill keeps the mirrored data in sync on a best-effort basis:
- **On layer review.** Write per-layer frontmatter first (source of truth), then update the root index: overwrite the H3 line and the note blockquote. If the second write fails, the first is still correct.
- **On opportunistic divergence detection.** When the skill is performing any operation on a layer and notices the root H3 or note blockquote disagrees with that layer's frontmatter, fix the root from the frontmatter and tell the user.
- **No background reconciliation step.** The skill does not periodically rebuild the index. It corrects only what it touches.

## Skill Changes

The following sections of `SKILL.md` change:

1. **Document Schema.** Replace the single-file description with the multi-file layout above. Document frontmatter shape, the four metadata sub-bullets (was five), and where each kind of note lives.
2. **Component bullet shape.** Drop the `Reviewer` sub-bullet from both the data-model/interface example and the unit-test example.
3. **Workflow.**
   - **Initialization.** Create the root file with the template (now including empty `## Layers` and `## Cross-Cutting Concerns` sections) and an empty `architecture/` directory. No layer files until layers are approved.
   - **Catalog.** Components are written to their per-layer file. Creating a layer creates a new per-layer file and registers it in the root's `## Layers` section. New layer's frontmatter starts `rating: ⚪ Unreviewed`, `reviewed: null`.
   - **Record Reviews.**
     - Component review: update the bullet's status, `Reviewed` date inside the per-layer file. Optionally append a Component Review Note. The root index does NOT change on a component review.
     - Layer review: overwrite the per-layer file's frontmatter (`rating`, `reviewed`, `note`), then overwrite the root index's H3 line + note blockquote for that layer. No history retained. Best-effort sync per the rule above.
   - **Discrepancy.** Same flagging behavior; per-layer file is where component-level discrepancies are recorded.
4. **Rules — additions.**
   - "Single-user log — no reviewer field anywhere. Date is sufficient for attribution."
   - "Only the most recent layer review is kept. New layer review overwrites the previous one (rating, date, note). No history."
   - "A layer review writes to BOTH the per-layer frontmatter and the root index. Per-layer frontmatter is the source of truth; if the two diverge, the root is corrected from the frontmatter."
5. **Common Mistakes / Red Flags.** Add entries for: forgetting to sync the root after a layer review; appending instead of overwriting on layer review; encoding rating or date in filenames; reintroducing a Reviewer field; reintroducing a Layer Review Notes history.
6. **example-architecture.md.** Replaced by an `example/` directory containing a complete miniature: root index + 2–3 layer files + 1 cross-cutting concern file, all in the new shape.

## Migration Plan

For existing single-file `architecture.md` (e.g. the Siyi project doc), the migration is a one-time transform the user can request:

1. Parse the existing file. Identify the Rating Scale section, each `## Layer:` section, and the `## Cross-Cutting Concerns` section.
2. Create `docs/reviews/architecture/` directory.
3. For each layer: extract its components into a new per-layer file with frontmatter derived from the **most recent** Layer Review Note (`rating`, `reviewed`, `note`). Older Layer Review Notes are discarded. If the layer has no Layer Review Notes, frontmatter is `rating: ⚪ Unreviewed`, `reviewed: null`, no `note` field. Strip `Reviewer` sub-bullets from component bullets. Strip name segments from Component Review Note blockquotes.
4. For each cross-cutting concern: same as a layer, file named `cross-cutting-<slug>.md`.
5. Rewrite the root `architecture.md` to the new shape: keep the Rating Scale section verbatim; rebuild `## Layers` and `## Cross-Cutting Concerns` from the migrated per-layer/concern files (H3 line + optional single note blockquote per file).
6. Existing historical prose mentioning names (within Component Review Notes, comments, etc.) is preserved verbatim. Only structural reviewer fields are removed.

After migration, the user reviews the result and the old single-file doc is replaced. No coexistence mode — the skill operates on the new layout only.

## Open Questions

None at spec time. The remaining decisions (exact rule wording, exact phrasing in Common Mistakes, the example directory's specific content) are details of skill writing and will be settled when updating `SKILL.md` via the `skill-creator` skill.

## Next Steps

After this spec is approved by the user, invoke the `skill-creator` skill to update `SKILL.md` and replace `example-architecture.md` with the new `example/` directory.
