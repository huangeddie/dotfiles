# Design: Maintaining Architecture Reviews Skill

**Date:** 2026-05-04
**Skill Name:** `maintaining-architecture-reviews`
**Package:** `superpowers`

## Problem

Collaborative codebases grow complex. Data schemas, interfaces, and unit tests span modules and abstraction levels. Over time, components are reviewed ad-hoc or not at all. There is no persistent record of:
- What architectural components exist
- What abstraction level they belong to
- When they were last reviewed
- Who reviewed them
- Whether they have changed since review

## Solution

A pi skill that instructs the agent to maintain a persistent running document at `docs/reviews/architecture.md` within any codebase. The document catalogs architectural components (data schemas, interfaces, unit tests) at hierarchical abstraction levels, tracks review history with reviewer names, auto-updates modification timestamps, and identifies stale or missing components.

---

## 1. Document Schema: `docs/reviews/architecture.md`

### 1.1 Frontmatter Banner

```markdown
# Architecture Review Log

> **To collaborators:** When updating this document, use the `maintaining-architecture-reviews` skill to ensure formatting consistency.
> Last full scan: 2024-03-22
> Review cadence: 30 days
```

### 1.2 Abstraction Layer Sections (H2)

Each abstraction layer gets an H2 heading. Layer names are **brainstormed with the user at initialization** (see Section 2.2.1) and reflect conceptual groupings, not directory structure:

```markdown
## Layer: Domain Model

## Layer: Application Services

## Layer: Infrastructure
```

The agent proposes layers based on patterns discovered in the codebase (e.g., domain types, service logic, external integrations, API handlers). The user approves, modifies, or rejects each proposal before the doc is written.

### 1.3 Component Category Subsections (H3)

Within each layer, three standard categories:

```markdown
### Data Schemas
### Interfaces
### Unit Tests
```

Additional categories may be added if the codebase has a different convention (e.g., `### Database Migrations`, `### API Contracts`), but the three core categories are always present.

### 1.4 Review Tables

Each category contains a markdown table with exactly these columns:

| Column | Description | Example |
|--------|-------------|---------|
| **Component** | Human-readable name | `UserSchema` |
| **File** | Relative path from repo root | `src/types.ts` |
| **Definition** | Code reference: type name, function name, or approximate line range | `` `interface User` `` or `L45-L62` |
| **Last Reviewed** | ISO-8601 date of the most recent human review | `2024-01-15` |
| **Reviewer** | Name of the person who performed the review | `Eddie` |
| **Last Modified** | ISO-8601 date of last code change to this component | `2024-03-20` |
| **Status** | Emoji indicator of review health | See Section 1.5 |

### 1.5 Status Indicators

| Status | Emoji | Condition |
|--------|-------|-----------|
| **Current** | 🟢 | `Last Reviewed` exists and is within cadence |
| **Stale** | 🟡 | `Last Reviewed` exists but exceeds cadence |
| **Missing** | 🔴 | Component listed in doc but no longer found in codebase |
| **Unreviewed** | ⚪ | Component found in codebase but never reviewed (`Last Reviewed: -`) |

### 1.6 Cross-Cutting Concerns Section

A special section for concepts that span multiple abstraction layers:

```markdown
## Cross-Cutting Concerns

### User Management (identified 2024-03-22)
> Spans layers: `UserSchema` (Domain Model) + `IUserService` (Application Services) + `user.test.ts` (Domain Model)
> Note: These components share the User concept across layers.

| Component | File | Definition | Layer | Last Reviewed | Reviewer | Last Modified | Status |
|-----------|------|-----------|-------|---------------|----------|---------------|--------|
| UserSchema | src/types.ts | `interface User` | Domain Model | 2024-01-15 | Eddie | 2024-03-20 | 🟡 stale |
| IUserService | src/services.ts | `interface IUserService` | Application Services | - | - | 2024-03-18 | ⚪ unreviewed |
```

Rules for Cross-Cutting Concerns:
- Agent may identify but **never reorganizes layers without user approval**
- Rejected identifications are kept but annotated: `> Rejected by {user} on {date}`
- This section is optional; omit if empty
- Components listed here also appear in their primary layer section (this is a cross-reference, not a move)

### 1.7 Document Rules

1. **Never delete rows** — mark 🔴 missing instead to preserve review history
2. **Auto-populated components** get ⚪ unreviewed status and `-` for Reviewer/Last Reviewed
3. **Last Modified** updates whenever the agent detects or makes code changes
4. **Last Reviewed & Reviewer** only update on explicit user confirmation
5. **Missing components** get a note below the table: `> Removed from codebase on {date}`

---

## 2. Agent Workflow

The skill instructs the agent to follow this workflow when working with any codebase:

### 2.1 Initialization

If `docs/reviews/architecture.md` does not exist:
1. Create the directory `docs/reviews/` if needed
2. Create the file from the template (Section 1)
3. Set `Last full scan` to today's date
4. Run a full exploration (Section 2.2)

### 2.2 Exploration & Layer Brainstorming

When the user asks to "review architecture", "check stale components", or the agent is about to make significant code changes:

#### Step A — Discover Components (Read-Only)

First, the agent explores the codebase **without writing to the doc**:

1. **Find Data Schemas:**
   - Search for type definitions using language-agnostic heuristics:
     - Files with `type`, `interface`, `struct`, `class`, `protocol` declarations
     - Database schemas, migration files, Protobuf, GraphQL, SQL
     - DTOs, models, data classes
   - Extract the **public/exported** schemas

2. **Find Interfaces/Contracts:**
   - Public function signatures, abstract methods, service interfaces
   - Exported functions, public methods on classes
   - API endpoint handlers, controller methods
   - Abstract base classes, trait implementations

3. **Find Unit Tests:**
   - Identify test files: `*test*`, `*spec*`, `*_test.*`
   - Group by what they test (layer-level, not every individual test function)

4. **Map directory structure** — note which directories contain which types of components

#### Step B — Propose Abstraction Layers (Brainstorm with User)

Before writing to `architecture.md`, the agent **presents a layer proposal to the user**:

```
I've discovered ~N components across your codebase. Here's a proposed abstraction layer organization:

**Layer: Domain Model** — core business types (User, Order, Payment)
**Layer: Application Services** — service logic, use cases (AuthService, BillingProcessor)
**Layer: API / Controllers** — request handlers, route definitions
**Layer: Infrastructure** — database access, external API clients, queue consumers

Does this look right? Would you rename, merge, split, or reorder any layers?
```

The agent:
- Proposes 3-6 layers based on patterns it found
- Explains the rationale for each layer (what components belong there)
- Asks the user to approve, rename, merge, split, or reorder
- Does **not** create the doc until the user confirms the layer structure

**If the user rejects a proposal**, the agent iterates with a revised proposal.

#### Step C — Catalog Under Approved Layers

Once layers are approved:
- Create H2 sections for each approved layer
- Add discovered components to the appropriate `### Data Schemas`, `### Interfaces`, or `### Unit Tests` table under the matching layer
- Components that don't clearly fit any layer go under the closest match with a `> Note: Categorization uncertain`

### 2.3 Cataloging

For each discovered component during exploration:
- **Already in doc** → update `Last Modified` date, verify `Status` is not 🔴
- **Not in doc** → add new row with `Status: ⚪ unreviewed`, `Last Reviewed: -`, `Reviewer: -`
- **In doc but not found in code** → mark 🔴 missing, add removal date note

### 2.4 Review Recording (Explicit User Action)

When the user indicates a review:
- Examples: "I reviewed auth-service", "mark user-api schemas as reviewed", "just reviewed the User interface"
- Agent updates `Last Reviewed` to today's date
- Agent updates `Reviewer` to the user's name (ask if unclear)
- Recalculate `Status` for affected rows

### 2.5 Stale Detection

After any update to the doc:
1. Read `Review cadence` from frontmatter (default 30 days)
2. Compare `Last Reviewed` + cadence against today's date
3. Update Status:
   - Within cadence or no date → 🟢 or ⚪
   - Exceeds cadence → 🟡
   - Component missing from codebase → 🔴

### 2.6 Missing Detection

For each row in the doc:
- Check if the `File` still contains the `Definition`
- If not found → mark 🔴 missing
- Add note: `> Removed from codebase on {today}`
- Preserve the row; do not delete

### 2.7 Layer Reorganization Proposals

Over time, the agent may discover that the initial layer structure doesn't fit new components or reveals a better organization. In this case:

- Propose a new layer or layer split to the user **before modifying the doc**
- If approved, migrate components to the new structure
- If rejected, keep the existing structure and add a `> Note: Could belong to {proposed layer}`

The agent never reorganizes layers without explicit user approval.

---

## 3. Error Handling & Edge Cases

| Situation | Agent Action |
|-----------|-------------|
| **Doc doesn't exist** | Create from template, run full exploration |
| **Component found in code but not in doc** | Add with ⚪ unreviewed; do not assume reviewer |
| **Component in doc but not in code** | Mark 🔴 missing; preserve row; note removal date |
| **Ambiguous layer boundaries** | Make best guess; add `> Note: Uncertain boundary — based on {heuristic}` |
| **Multiple reviewers over time** | Track most recent in table; append history as `> Previously reviewed by {name} on {date}` if significant |
| **Agent makes code changes** | After implementing, update `Last Modified` for affected components; do NOT update `Last Reviewed` unless user confirms |
| **Large codebase (100+ components)** | Focus on **public API surface** first; add `> Additional internals not cataloged` note rather than creating an unreadable doc |
| **User disagrees with proposed cross-cutting concern** | Keep in Cross-Cutting Concerns section; annotate `> Rejected by {user} on {date}` |
| **User disagrees with proposed layer reorganization** | Do not reorganize; add `> Note: Rejected layer reorganization proposed by agent on {date}` to affected components |
| **Collaborator edits doc manually** | On next run, parse what is parseable; flag irregular rows with `> Warning: Non-standard row detected` |
| **Unclear whether something is a schema or interface** | Add to whichever is closer; add `> Note: Categorization uncertain` |
| **Test file tests multiple layers** | List under the primary layer it tests; add cross-reference: `> Also tests: {other layer}` |

### Key Principles for the Agent

1. **Preserve history** — never delete rows, only mark 🔴 missing
2. **Don't invent reviews** — ⚪ unreviewed is a valid state
3. **Err on the side of cataloging** — better to have an unreviewed component listed than to miss it
4. **Ask when uncertain** — if categorization or boundary is unclear, ask the user rather than silently guess
5. **Auto-update Last Modified, not Last Reviewed** — code changes ≠ reviews

---

## 4. Skill Testing Strategy

This is a **technique + discipline** skill. Testing follows the TDD-for-skills methodology (see `writing-skills` skill).

### 4.1 Test Scenarios (Pressure Tests)

Run subagent scenarios WITHOUT the skill first to establish baseline behavior. Then write the skill to address failures.

| Test ID | Scenario | Baseline Expectation (without skill) | Skill Requirement |
|---------|----------|--------------------------------------|-------------------|
| T1 | Cold start — no `docs/reviews/architecture.md` exists | Agent may ignore or create ad-hoc notes | Agent must create standardized doc from template |
| T2 | Stale detection — doc has old review dates | Agent may not check dates or understand cadence | Agent must correctly identify stale vs current |
| T3 | Code change tracking — agent adds new type | Agent may forget to update doc | Agent must update `Last Modified` without touching `Last Reviewed` |
| T4 | Missing component — file deleted since last scan | Agent may delete row from doc | Agent must mark 🔴 missing and preserve history |
| T5 | Abstraction proposal — cross-cutting types | Agent may not recognize patterns | Agent must suggest groupings in Cross-Cutting Concerns |
| T6 | Manual edit resilience — collaborator adds malformed row | Agent may crash or ignore entire doc | Agent must parse what it can, flag irregularities |
| T7 | Large codebase — 200+ files with types | Agent may catalog everything and create unreadable doc | Agent must focus on public surface, defer internals |
| T8 | User says "mark as reviewed" | Agent may update wrong field or wrong component | Agent must update correct `Last Reviewed` + `Reviewer` |

### 4.2 Rationalization Watch List

Document expected rationalizations from baseline testing to bulletproof the skill:

| Rationalization | Counter in Skill |
|-----------------|------------------|
| "The doc is too big, I'll just summarize" | Explicit rule: never summarize; always update tables |
| "Code changes are basically a review" | Explicit rule: `Last Modified` ≠ `Last Reviewed`; never conflate |
| "Missing component should be deleted to keep doc clean" | Explicit rule: never delete rows; mark 🔴 missing |
| "I'll guess the category rather than ask" | Explicit rule: ask when uncertain; note if forced to guess |
| "Cross-cutting concerns are too speculative" | Explicit rule: identify but never reorganize without approval |

---

## 5. Skill Document Structure (SKILL.md)

The final `SKILL.md` will follow the standard superpowers skill format:

### 5.1 Frontmatter

```yaml
---
name: maintaining-architecture-reviews
description: Use when cataloging, reviewing, or tracking the architectural health of a codebase — data schemas, interfaces, contracts, and unit tests across modules and abstraction levels
---
```

### 5.2 Body Sections

1. **Overview** — What this skill does in 1-2 sentences
2. **When to Use** — Triggering conditions (before major refactor, periodic health check, onboarding to new codebase, after significant code changes)
3. **Document Schema** — Quick reference for `docs/reviews/architecture.md` format (condensed from Section 1)
4. **Workflow** — Step-by-step instructions for the agent (condensed from Section 2)
5. **Exploration Heuristics** — Language-agnostic patterns for finding schemas, interfaces, and tests
6. **Status & Rules** — Status indicators and key principles
7. **Common Mistakes** — Rationalization table from Section 4.2
8. **Example** — A small but complete example of an architecture.md section

### 5.3 Supporting Files

- `example-architecture.md` — A complete example document for reference
- `exploration-heuristics.md` — Extended language-agnostic patterns for component discovery (optional, if heuristics grow beyond 50 lines)

---

## 6. Implementation Plan Outline

1. **RED Phase — Baseline Testing**
   - Write pressure scenario documents (T1-T8)
   - Run subagent tests WITHOUT skill
   - Document baseline rationalizations verbatim

2. **GREEN Phase — Write Minimal Skill**
   - Create `maintaining-architecture-reviews/SKILL.md`
   - Address specific baseline failures
   - Re-run scenarios WITH skill; verify compliance

3. **REFACTOR Phase — Close Loopholes**
   - Identify new rationalizations from testing
   - Add explicit counters
   - Re-test until bulletproof

4. **Deployment**
   - Place skill in `dot_agents/exact_packages/superpowers/exact_skills/maintaining-architecture-reviews/`
   - Commit to chezmoi
   - Apply chezmoi to deploy

---

## 7. Open Decisions

1. **Skill name** — `maintaining-architecture-reviews` (pending final approval)
2. **Default cadence** — 30 days (configurable in frontmatter)
3. **Whether to include a generated table-of-contents** in the doc for large codebases

---

**Next Step:** User review of this spec, then invoke `writing-plans` to create the detailed implementation plan.
