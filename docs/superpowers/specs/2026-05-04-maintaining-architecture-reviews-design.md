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

### 1.2 Module Sections (H2)

Each detected module or package gets an H2 heading:

```markdown
## Module: auth-service
```

Modules are initially discovered from directory structure. The agent may propose reorganizations over time.

### 1.3 Component Category Subsections (H3)

Within each module, three standard categories:

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

### 1.6 Proposed Abstractions Section

A special section for cross-cutting groupings the agent discovers:

```markdown
## Proposed Abstractions

### User Management (proposed 2024-03-22)
> Groups: `UserSchema` (auth-service) + `IUserService` (user-api) + `user.test.ts` (user-api)
> Note: These components share the User concept but are scattered across modules.

| Component | File | Definition | Last Reviewed | Reviewer | Last Modified | Status |
|-----------|------|-----------|---------------|----------|---------------|--------|
| UserSchema | auth-service/types.ts | `interface User` | 2024-01-15 | Eddie | 2024-03-20 | 🟡 stale |
| IUserService | user-api/service.ts | `interface IUserService` | - | - | 2024-03-18 | ⚪ unreviewed |
```

Rules for Proposed Abstractions:
- Agent may propose but **never reorganizes canonical structure without user approval**
- Rejected proposals are kept but annotated: `> Rejected by {name} on {date}`
- This section is optional; omit if empty

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

### 2.2 Exploration

When the user asks to "review architecture", "check stale components", or the agent is about to make significant code changes:

**Step A — Map modules:**
- List directory structure
- Identify top-level packages/modules (top-level dirs, `src/` subdirs, workspace packages, `go.mod` modules, etc.)
- Create an H2 section per module

**Step B — Find Data Schemas:**
- Search for type definitions using language-agnostic heuristics:
  - Files with `type`, `interface`, `struct`, `class`, `protocol` declarations
  - Database schemas, migration files, Protobuf, GraphQL, SQL
  - DTOs, models, data classes
- Extract the **public/exported** schemas (surface-level types, not private helpers)
- Add each to the `### Data Schemas` table with ⚪ unreviewed

**Step C — Find Interfaces/Contracts:**
- Search for public function signatures, abstract methods, service interfaces
- Exported functions, public methods on classes
- API endpoint handlers, controller methods
- Abstract base classes, trait implementations
- Add each to the `### Interfaces` table with ⚪ unreviewed

**Step D — Find Unit Tests:**
- Identify test files: `*test*`, `*spec*`, `*_test.*`
- Group by module they test (module-level, not every individual test function)
- Add each module test suite to the `### Unit Tests` table with ⚪ unreviewed

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

### 2.7 Abstraction Proposals

After cataloging, scan for cross-cutting patterns:
- Same schema/interface name in multiple modules → suggest shared abstraction
- Schema + interface + tests sharing a concept but in different modules → suggest Proposed Abstraction grouping
- Module tables growing very large → suggest subsystem split

Present proposals to the user in the `## Proposed Abstractions` section. Do not reorganize without approval.

---

## 3. Error Handling & Edge Cases

| Situation | Agent Action |
|-----------|-------------|
| **Doc doesn't exist** | Create from template, run full exploration |
| **Component found in code but not in doc** | Add with ⚪ unreviewed; do not assume reviewer |
| **Component in doc but not in code** | Mark 🔴 missing; preserve row; note removal date |
| **Ambiguous module boundaries** | Make best guess; add `> Note: Uncertain boundary — based on {heuristic}` |
| **Multiple reviewers over time** | Track most recent in table; append history as `> Previously reviewed by {name} on {date}` if significant |
| **Agent makes code changes** | After implementing, update `Last Modified` for affected components; do NOT update `Last Reviewed` unless user confirms |
| **Large codebase (100+ components)** | Focus on **public API surface** first; add `> Additional internals not cataloged` note rather than creating an unreadable doc |
| **User disagrees with proposed abstraction** | Keep in Proposed Abstractions section; annotate `> Rejected by {user} on {date}` |
| **Collaborator edits doc manually** | On next run, parse what is parseable; flag irregular rows with `> Warning: Non-standard row detected` |
| **Unclear whether something is a schema or interface** | Add to whichever is closer; add `> Note: Categorization uncertain` |
| **Test file tests multiple modules** | List under the primary module it tests; add cross-reference: `> Also tests: {other module}` |

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
| T5 | Abstraction proposal — cross-cutting types | Agent may not recognize patterns | Agent must suggest groupings in Proposed Abstractions |
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
| "Proposed abstractions are too speculative" | Explicit rule: propose but never reorganize without approval |

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
