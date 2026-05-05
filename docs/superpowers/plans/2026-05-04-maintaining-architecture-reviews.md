# maintaining-architecture-reviews Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the `maintaining-architecture-reviews` pi skill that instructs agents to maintain a persistent `docs/reviews/architecture.md` document tracking codebase architectural components across abstraction layers, with review history, stale detection, and review notes.

**Architecture:** TDD-for-skills methodology: write pressure scenarios, run baseline tests without skill to document rationalizations, write minimal skill addressing failures, verify with subagents, refactor loopholes. The skill is a markdown instruction document (SKILL.md) for future pi agents.

**Tech Stack:** pi skills (markdown documentation), subagent testing via `subagent` tool with fresh context

---

## File Structure

| File | Purpose | Created/Modified |
|------|---------|-----------------|
| `dot_agents/exact_packages/superpowers/exact_skills/maintaining-architecture-reviews/SKILL.md` | Main skill document — agent instructions | Create |
| `dot_agents/exact_packages/superpowers/exact_skills/maintaining-architecture-reviews/example-architecture.md` | Complete example of architecture.md format | Create |
| `dot_agents/exact_packages/superpowers/exact_skills/maintaining-architecture-reviews/test-pressure-1.md` | Pressure scenario: cold start | Create |
| `dot_agents/exact_packages/superpowers/exact_skills/maintaining-architecture-reviews/test-pressure-2.md` | Pressure scenario: stale detection | Create |
| `dot_agents/exact_packages/superpowers/exact_skills/maintaining-architecture-reviews/test-pressure-3.md` | Pressure scenario: code change tracking | Create |
| `dot_agents/exact_packages/superpowers/exact_skills/maintaining-architecture-reviews/test-pressure-4.md` | Pressure scenario: missing component | Create |
| `dot_agents/exact_packages/superpowers/exact_skills/maintaining-architecture-reviews/test-pressure-5.md` | Pressure scenario: abstraction proposal | Create |
| `dot_agents/exact_packages/superpowers/exact_skills/maintaining-architecture-reviews/test-pressure-6.md` | Pressure scenario: manual edit resilience | Create |
| `dot_agents/exact_packages/superpowers/exact_skills/maintaining-architecture-reviews/test-pressure-7.md` | Pressure scenario: large codebase | Create |
| `dot_agents/exact_packages/superpowers/exact_skills/maintaining-architecture-reviews/test-pressure-8.md` | Pressure scenario: review with comments | Create |

---

## Phase 1: RED — Baseline Testing

### Task 1: Create Skill Directory Structure

**Files:**
- Create: `dot_agents/exact_packages/superpowers/exact_skills/maintaining-architecture-reviews/` (directory)

- [ ] **Step 1: Create directory**

```bash
mkdir -p dot_agents/exact_packages/superpowers/exact_skills/maintaining-architecture-reviews
```

- [ ] **Step 2: Commit directory creation**

```bash
git add dot_agents/exact_packages/superpowers/exact_skills/maintaining-architecture-reviews
git commit -m "test: create maintaining-architecture-reviews skill directory

Track A — Contracts & Verification: skill structure and test fixtures.
Refs: architecture review skill implementation plan"
```

---

### Task 2: Write All 8 Pressure Scenario Files

**Files:**
- Create: `dot_agents/exact_packages/superpowers/exact_skills/maintaining-architecture-reviews/test-pressure-1.md`
- Create: `dot_agents/exact_packages/superpowers/exact_skills/maintaining-architecture-reviews/test-pressure-2.md`
- Create: `dot_agents/exact_packages/superpowers/exact_skills/maintaining-architecture-reviews/test-pressure-3.md`
- Create: `dot_agents/exact_packages/superpowers/exact_skills/maintaining-architecture-reviews/test-pressure-4.md`
- Create: `dot_agents/exact_packages/superpowers/exact_skills/maintaining-architecture-reviews/test-pressure-5.md`
- Create: `dot_agents/exact_packages/superpowers/exact_skills/maintaining-architecture-reviews/test-pressure-6.md`
- Create: `dot_agents/exact_packages/superpowers/exact_skills/maintaining-architecture-reviews/test-pressure-7.md`
- Create: `dot_agents/exact_packages/superpowers/exact_skills/maintaining-architecture-reviews/test-pressure-8.md`

- [ ] **Step 1: Write T1 — Cold Start**

Create `test-pressure-1.md` with this content:

```markdown
# Pressure Test T1: Cold Start

## Scenario
You enter a codebase with no `docs/reviews/architecture.md`. The codebase has these files:

- `src/types.ts`:
  ```typescript
  export interface User {
    id: string;
    name: string;
    email: string;
  }
  export interface Order {
    id: string;
    userId: string;
    total: number;
    status: 'pending' | 'shipped' | 'delivered';
  }
  ```
- `src/services.ts`:
  ```typescript
  export class AuthService {
    login(user: User): string { return 'token'; }
    logout(token: string): void {}
  }
  export class OrderService {
    createOrder(userId: string, items: string[]): Order { return {} as Order; }
  }
  ```
- `src/services.test.ts`:
  ```typescript
  import { AuthService } from './services';
  describe('AuthService', () => {
    test('login returns token', () => { expect(new AuthService().login({} as any)).toBe('token'); });
  });
  ```

## Task
Set up architecture review tracking for this codebase. Create the necessary documentation.

## What the Agent SHOULD Do (compliant behavior)
- Create `docs/reviews/architecture.md`
- Use the standard format: # Architecture Review Log with frontmatter
- Include layer sections (brainstorm with user about layer names)
- Include ### Data Models, ### Interfaces, ### Unit Tests tables
- Catalog all discovered components (User, Order, AuthService, OrderService, tests)
- Mark all components as unreviewed (⚪)
- Do NOT invent review dates or reviewers
- Do NOT create simple bullet lists instead of structured tables

## Document the Agent's Actual Behavior
After running this scenario WITHOUT the skill loaded, document:
1. Did the agent create `docs/reviews/architecture.md`?
2. What format did it use? (tables, bullet lists, plain text?)
3. Did it include all three categories (Data Models, Interfaces, Unit Tests)?
4. Did it mark components as unreviewed or invent dates?
5. Did it try to organize by layers or just by files?
6. Any rationalizations the agent used for shortcuts?
```

- [ ] **Step 2: Write T2 — Stale Detection**

Create `test-pressure-2.md` with this content:

```markdown
# Pressure Test T2: Stale Detection

## Scenario
You have an existing `docs/reviews/architecture.md` with these contents:

```markdown
# Architecture Review Log

> Last full scan: 2024-01-01
> Review cadence: 30 days

## Layer: Domain Model

### Data Models

| Component | File | Definition | Last Reviewed | Reviewer | Last Modified | Status |
|-----------|------|-----------|---------------|----------|---------------|--------|
| User | src/types.ts | `interface User` | 2024-01-15 | Eddie | 2024-03-20 | 🟢 current |
| Order | src/types.ts | `interface Order` | 2023-12-01 | Alice | 2024-03-18 | 🟢 current |

### Interfaces

| Component | File | Definition | Last Reviewed | Reviewer | Last Modified | Status |
|-----------|------|-----------|---------------|----------|---------------|--------|
| IAuthService | src/services.ts | `interface IAuthService` | 2024-01-15 | Eddie | 2024-03-22 | 🟢 current |
```

Today is 2024-03-25.

## Task
Check the architecture review document for stale components that need re-review.

## What the Agent SHOULD Do (compliant behavior)
- Read the Review cadence from frontmatter (30 days)
- Compare Last Reviewed + 30 days against today's date (2024-03-25)
- User: Last Reviewed 2024-01-15 + 30 days = 2024-02-14 < 2024-03-25 → 🟡 stale
- Order: Last Reviewed 2023-12-01 + 30 days = 2023-12-31 < 2024-03-25 → 🟡 stale
- IAuthService: Last Reviewed 2024-01-15 + 30 days = 2024-02-14 < 2024-03-25 → 🟡 stale
- Report which components are stale and why
- Update the Status column in the document

## Document the Agent's Actual Behavior
After running this scenario WITHOUT the skill loaded, document:
1. Did the agent correctly identify all stale components?
2. Did it update the Status column in the doc?
3. Did it explain the calculation (Last Reviewed + cadence vs today)?
4. Did it miss any components or misidentify current ones as stale?
5. Any rationalizations for skipping the calculation?
```

- [ ] **Step 3: Write T3 — Code Change Tracking**

Create `test-pressure-3.md` with this content:

```markdown
# Pressure Test T3: Code Change Tracking

## Scenario
You are working in a codebase with this existing `docs/reviews/architecture.md`:

```markdown
# Architecture Review Log

> Last full scan: 2024-01-01
> Review cadence: 30 days

## Layer: Domain Model

### Data Models

| Component | File | Definition | Last Reviewed | Reviewer | Last Modified | Status |
|-----------|------|-----------|---------------|----------|---------------|--------|
| User | src/types.ts | `interface User` | 2024-02-01 | Eddie | 2024-02-01 | 🟢 current |
```

You need to add a new field to the User interface:

```typescript
export interface User {
  id: string;
  name: string;
  email: string;
  phone?: string;  // NEW FIELD
}
```

## Task
Make the code change and update the architecture review document accordingly.

## What the Agent SHOULD Do (compliant behavior)
- Modify `src/types.ts` to add the phone field
- Update `Last Modified` for the User component to today's date
- Do NOT update `Last Reviewed` — code changes are not reviews
- Do NOT change `Reviewer`
- Status should remain 🟢 (if still within cadence) or become 🟡 (if cadence exceeded)

## Document the Agent's Actual Behavior
After running this scenario WITHOUT the skill loaded, document:
1. Did the agent update `Last Modified` to today's date?
2. Did it correctly leave `Last Reviewed` unchanged?
3. Did it leave `Reviewer` unchanged?
4. Did it confuse code changes with reviews?
5. Any rationalizations for conflating modification and review?
```

- [ ] **Step 4: Write T4 — Missing Component**

Create `test-pressure-4.md` with this content:

```markdown
# Pressure Test T4: Missing Component

## Scenario
You have this existing `docs/reviews/architecture.md`:

```markdown
# Architecture Review Log

> Last full scan: 2024-01-01
> Review cadence: 30 days

## Layer: Domain Model

### Data Models

| Component | File | Definition | Last Reviewed | Reviewer | Last Modified | Status |
|-----------|------|-----------|---------------|----------|---------------|--------|
| User | src/types.ts | `interface User` | 2024-02-01 | Eddie | 2024-02-01 | 🟢 current |
| Product | src/types.ts | `interface Product` | 2024-02-01 | Eddie | 2024-02-01 | 🟢 current |
```

The codebase has been refactored. `Product` interface has been removed from `src/types.ts` (moved to a separate product service). The file now only contains the User interface.

## Task
Update the architecture review document to reflect the current state of the codebase.

## What the Agent SHOULD Do (compliant behavior)
- Mark Product as 🔴 missing in the Status column
- Add a note below the table: `> Removed from codebase on 2024-03-20`
- Preserve the Product row — do NOT delete it
- Verify User still exists and update its Status if needed

## Document the Agent's Actual Behavior
After running this scenario WITHOUT the skill loaded, document:
1. Did the agent mark Product as 🔴 missing or delete the row?
2. Did it preserve the row for history?
3. Did it add a removal date note?
4. Did it explain why deletion is wrong?
5. Any rationalizations for "cleaning up" the doc by removing old entries?
```

- [ ] **Step 5: Write T5 — Abstraction Proposal**

Create `test-pressure-5.md` with this content:

```markdown
# Pressure Test T5: Abstraction Proposal

## Scenario
You have this existing `docs/reviews/architecture.md`:

```markdown
# Architecture Review Log

> Last full scan: 2024-01-01
> Review cadence: 30 days

## Layer: Domain Model

### Data Models

| Component | File | Definition | Last Reviewed | Reviewer | Last Modified | Status |
|-----------|------|-----------|---------------|----------|---------------|--------|
| User | src/types.ts | `interface User` | 2024-02-01 | Eddie | 2024-02-01 | 🟢 current |
| UserSettings | src/settings.ts | `interface UserSettings` | - | - | 2024-03-15 | ⚪ unreviewed |

## Layer: Infrastructure

### Data Models

| Component | File | Definition | Last Reviewed | Reviewer | Last Modified | Status |
|-----------|------|-----------|---------------|----------|---------------|--------|
| UserNotification | src/notifications.ts | `interface UserNotification` | - | - | 2024-03-18 | ⚪ unreviewed |
```

## Task
Review the architecture document. Are there any cross-cutting patterns or abstraction improvements you would suggest?

## What the Agent SHOULD Do (compliant behavior)
- Identify that User, UserSettings, and UserNotification all relate to the User concept
- Propose a "User Management" cross-cutting concern in a `## Cross-Cutting Concerns` section
- Present the proposal to the user for approval
- Do NOT reorganize the canonical layer structure without user approval
- Do NOT move components between layers without user approval

## Document the Agent's Actual Behavior
After running this scenario WITHOUT the skill loaded, document:
1. Did the agent recognize the cross-cutting pattern?
2. Did it propose a grouping or just ignore it?
3. Did it try to reorganize layers without asking?
4. Did it present the proposal clearly to the user?
5. Any rationalizations for skipping abstraction analysis?
```

- [ ] **Step 6: Write T6 — Manual Edit Resilience**

Create `test-pressure-6.md` with this content:

```markdown
# Pressure Test T6: Manual Edit Resilience

## Scenario
You have this existing `docs/reviews/architecture.md` (note: a collaborator manually edited it and added an irregular row):

```markdown
# Architecture Review Log

> Last full scan: 2024-01-01
> Review cadence: 30 days

## Layer: Domain Model

### Data Models

| Component | File | Definition | Last Reviewed | Reviewer | Last Modified | Status |
|-----------|------|-----------|---------------|----------|---------------|--------|
| User | src/types.ts | `interface User` | 2024-02-01 | Eddie | 2024-02-01 | 🟢 current |
| Order | | | | | | |
```

The second row (Order) is malformed — missing most columns. A collaborator added it manually without following the format.

## Task
Continue maintaining the architecture review document. The codebase now also has a `Payment` interface in `src/payments.ts`.

## What the Agent SHOULD Do (compliant behavior)
- Parse the malformed Order row as best as possible
- Flag the irregular row with a warning note: `> Warning: Non-standard row detected`
- Add the new Payment component with proper formatting
- Do NOT crash or ignore the entire document due to one bad row
- Do NOT silently fix the malformed row without noting it

## Document the Agent's Actual Behavior
After running this scenario WITHOUT the skill loaded, document:
1. Did the agent crash, ignore the doc, or try to parse the malformed row?
2. Did it add the new Payment component correctly?
3. Did it flag the irregular row?
4. Did it attempt to "fix" the malformed row by guessing values?
5. Any rationalizations for giving up on the whole doc?
```

- [ ] **Step 7: Write T7 — Large Codebase**

Create `test-pressure-7.md` with this content:

```markdown
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
```

- [ ] **Step 8: Write T8 — Review with Comments**

Create `test-pressure-8.md` with this content:

```markdown
# Pressure Test T8: Review with Comments

## Scenario
You have this existing `docs/reviews/architecture.md`:

```markdown
# Architecture Review Log

> Last full scan: 2024-01-01
> Review cadence: 30 days

## Layer: Domain Model

### Data Models

| Component | File | Definition | Last Reviewed | Reviewer | Last Modified | Status |
|-----------|------|-----------|---------------|----------|---------------|--------|
| User | src/types.ts | `interface User` | 2024-02-01 | Eddie | 2024-02-01 | 🟢 current |
```

The user says: "I reviewed the User interface today. We need to add nullable fields for partial updates and consider extracting Address into a separate type."

## Task
Record the review in the architecture review document.

## What the Agent SHOULD Do (compliant behavior)
- Update `Last Reviewed` to today's date
- Update `Reviewer` to the user's name
- Create a `#### Review Notes` subsection under `### Data Models`
- Add: `> **YYYY-MM-DD — {Reviewer}:** Need to add nullable fields for partial updates. Consider extracting Address into separate type.`
- Recalculate Status

## Document the Agent's Actual Behavior
After running this scenario WITHOUT the skill loaded, document:
1. Did the agent update Last Reviewed and Reviewer correctly?
2. Did it create a Review Notes subsection?
3. Did it format the note correctly with date, name, and comment?
4. Did it drop the comment entirely?
5. Did it try to add the comment inline in the table?
```

- [ ] **Step 9: Commit pressure scenarios**

```bash
git add dot_agents/exact_packages/superpowers/exact_skills/maintaining-architecture-reviews/test-pressure-*.md
git commit -m "test: add architecture review skill pressure test scenarios

Track A — Contracts & Verification: test fixtures for T1-T8 baseline tests.
Refs: architecture review skill implementation plan"
```

---

### Task 3: Run Baseline Tests T1-T4

**Context:** Run subagent baseline tests WITHOUT the skill loaded. Use fresh context for each. Document rationalizations verbatim.

**Files:**
- Read: `test-pressure-1.md` through `test-pressure-4.md`
- Create: `baseline-findings-t1.md` through `baseline-findings-t4.md` (observation notes)

- [ ] **Step 1: Run T1 baseline (cold start)**

Dispatch a subagent with fresh context. Task: read and execute the scenario from `test-pressure-1.md`. Do NOT load the maintaining-architecture-reviews skill.

Save the subagent's full output to `baseline-findings-t1.md`.

Document in `baseline-findings-t1.md`:
- What did the agent create? (file path, format)
- What components did it catalog?
- Did it use tables, bullet lists, or plain text?
- Did it invent review dates?
- What rationalizations did it use for any shortcuts?

- [ ] **Step 2: Run T2 baseline (stale detection)**

Dispatch a subagent with fresh context. Task: read and execute the scenario from `test-pressure-2.md`. Do NOT load the maintaining-architecture-reviews skill.

Save output to `baseline-findings-t2.md`.

Document:
- Did it correctly calculate stale components?
- Did it update Status in the doc?
- What calculation errors did it make?
- What rationalizations for skipping math?

- [ ] **Step 3: Run T3 baseline (code change tracking)**

Dispatch a subagent with fresh context. Task: read and execute the scenario from `test-pressure-3.md`. Do NOT load the maintaining-architecture-reviews skill.

Save output to `baseline-findings-t3.md`.

Document:
- Did it update Last Modified or Last Reviewed?
- Did it conflate code changes with reviews?
- What rationalizations for "this is basically a review"?

- [ ] **Step 4: Run T4 baseline (missing component)**

Dispatch a subagent with fresh context. Task: read and execute the scenario from `test-pressure-4.md`. Do NOT load the maintaining-architecture-reviews skill.

Save output to `baseline-findings-t4.md`.

Document:
- Did it delete the row or mark missing?
- Did it preserve history?
- What rationalizations for "cleaning up" the doc?

---

### Task 4: Run Baseline Tests T5-T8

**Context:** Continue baseline testing. Fresh context for each subagent.

**Files:**
- Read: `test-pressure-5.md` through `test-pressure-8.md`
- Create: `baseline-findings-t5.md` through `baseline-findings-t8.md`

- [ ] **Step 1: Run T5 baseline (abstraction proposal)**

Dispatch subagent with fresh context. Task from `test-pressure-5.md`. No skill loaded.

Save to `baseline-findings-t5.md`.

Document:
- Did it recognize cross-cutting patterns?
- Did it try to reorganize without asking?
- What rationalizations for skipping abstraction analysis?

- [ ] **Step 2: Run T6 baseline (manual edit resilience)**

Dispatch subagent with fresh context. Task from `test-pressure-6.md`. No skill loaded.

Save to `baseline-findings-t6.md`.

Document:
- Did it handle the malformed row gracefully?
- Did it add the new component correctly?
- What rationalizations for giving up on the whole doc?

- [ ] **Step 3: Run T7 baseline (large codebase)**

Dispatch subagent with fresh context. Task from `test-pressure-7.md`. No skill loaded.

Save to `baseline-findings-t7.md`.

Document:
- Did it catalog everything or nothing?
- Did it focus on public surfaces?
- What rationalizations for skipping due to size?

- [ ] **Step 4: Run T8 baseline (review with comments)**

Dispatch subagent with fresh context. Task from `test-pressure-8.md`. No skill loaded.

Save to `baseline-findings-t8.md`.

Document:
- Did it capture the review comment?
- Did it format the note correctly?
- Did it drop the comment entirely?

---

### Task 5: Synthesize Baseline Findings into Rationalization Table

**Files:**
- Read: `baseline-findings-t1.md` through `baseline-findings-t8.md`
- Create: `baseline-rationalizations.md`

- [ ] **Step 1: Read all baseline findings**

Read each `baseline-findings-t*.md` and extract the rationalizations the subagent used.

- [ ] **Step 2: Write rationalization table**

Create `baseline-rationalizations.md` with this structure:

```markdown
# Baseline Rationalizations

## T1: Cold Start
| Rationalization | Behavior |
|-----------------|----------|
| (paste verbatim from findings) | (what the agent did) |

## T2: Stale Detection
...

## Synthesized Patterns
| Pattern | Frequency | Severity |
|---------|-----------|----------|
| (common rationalizations across tests) | (how many tests) | (how bad) |
```

- [ ] **Step 3: Commit**

```bash
git add dot_agents/exact_packages/superpowers/exact_skills/maintaining-architecture-reviews/baseline-*.md
git commit -m "test: document baseline rationalizations from T1-T8

Track A — Contracts & Verification: baseline test results and rationalization table.
Refs: RED phase of architecture review skill TDD"
```

---

## Phase 2: GREEN — Write Skill

### Task 6: Write SKILL.md — Frontmatter, Overview, When to Use

**Files:**
- Create: `dot_agents/exact_packages/superpowers/exact_skills/maintaining-architecture-reviews/SKILL.md`

- [ ] **Step 1: Write frontmatter and overview**

Write the SKILL.md file starting with:

```markdown
---
name: maintaining-architecture-reviews
description: Use when cataloging, reviewing, or tracking the architectural health of a codebase — data models, interfaces, contracts, and unit tests across modules and abstraction levels
---

# Maintaining Architecture Reviews

## Overview

Maintain a persistent `docs/reviews/architecture.md` document that catalogs your codebase's architectural components — data models, interfaces, and unit tests — organized by abstraction layers. Track review history, detect stale components, and capture review notes.

**Core principle:** A reviewed codebase is an understood codebase. Unreviewed components are unowned components.

## When to Use

**Always when:**
- Entering a new codebase (initial cataloging)
- Before major refactoring
- After significant code changes
- Periodic architecture health checks (monthly/quarterly)
- Onboarding a new team member to the architecture

**Before:**
- Any task that touches data models, interfaces, or test organization
```

- [ ] **Step 2: Commit**

```bash
git add dot_agents/exact_packages/superpowers/exact_skills/maintaining-architecture-reviews/SKILL.md
git commit -m "impl: add SKILL.md frontmatter, overview, and when-to-use

Track B — Implementation: skill document header sections.
Refs: GREEN phase of architecture review skill TDD"
```

---

### Task 7: Write SKILL.md — Document Schema Section

**Files:**
- Modify: `dot_agents/exact_packages/superpowers/exact_skills/maintaining-architecture-reviews/SKILL.md`

- [ ] **Step 1: Append Document Schema section**

Append this section to the SKILL.md:

```markdown
## Document Schema

`docs/reviews/architecture.md` follows this convention:

- `## Layer: X` — abstraction layer sections. Brainstorm layer names with the user before writing. Propose 3-6 layers based on discovered patterns. Wait for approval.
- `### Data Models` — types, structs, classes, schemas, DTOs, dataclasses
- `### Interfaces` — public functions, methods, handlers, contracts
- `### Unit Tests` — test suites grouped by layer
- Tables with columns: Component | File | Definition | Last Reviewed | Reviewer | Last Modified | Status
- Status: 🟢 current | 🟡 stale | 🔴 missing | ⚪ unreviewed
- `#### Review Notes` — optional dated/signed comments below each table
- `## Cross-Cutting Concerns` — concepts spanning multiple layers

### Status Indicators

| Status | Emoji | Condition |
|--------|-------|-----------|
| Current | 🟢 | `Last Reviewed` exists and is within cadence |
| Stale | 🟡 | `Last Reviewed` exists but exceeds cadence |
| Missing | 🔴 | Component listed in doc but no longer found in codebase |
| Unreviewed | ⚪ | Component found in codebase but never reviewed |

### Frontmatter Banner

```markdown
# Architecture Review Log

> **To collaborators:** When updating this document, use the `maintaining-architecture-reviews` skill.
> Last full scan: YYYY-MM-DD
> Review cadence: 30 days
```

### Review Notes Format

```markdown
#### Review Notes

> **YYYY-MM-DD — Name:** Comment text goes here.
> **YYYY-MM-DD — Name:** Another comment.
```

- Each note starts with `> **YYYY-MM-DD — Name:**`
- Ordered chronologically (oldest first)
- Omit the `#### Review Notes` subsection if no notes exist
```

- [ ] **Step 2: Commit**

```bash
git commit -am "impl: add document schema section to SKILL.md

Track B — Implementation: schema reference for architecture review doc.
Refs: GREEN phase of architecture review skill TDD"
```

---

### Task 8: Write SKILL.md — Workflow and Exploration Heuristics

**Files:**
- Modify: `dot_agents/exact_packages/superpowers/exact_skills/maintaining-architecture-reviews/SKILL.md`

- [ ] **Step 1: Append Workflow section**

Append this section to the SKILL.md:

```markdown
## Workflow

### 1. Initialization
If `docs/reviews/architecture.md` doesn't exist, create it from the template above and run exploration.

### 2. Explore (Read-Only First)

**Find Data Models:**
- Files with `type`, `interface`, `struct`, `class`, `protocol` declarations
- Database schemas, migrations, Protobuf, GraphQL, SQL
- DTOs, models, dataclasses, value objects
- Focus on **public/exported** data models

**Find Interfaces:**
- Public function signatures, exported methods
- Abstract methods, trait implementations
- API endpoint handlers, controller methods
- Service interfaces, ports in hexagonal architecture

**Find Unit Tests:**
- Files matching `*test*`, `*spec*`, `*_test.*`
- Group by layer tested, not individual test functions
- Include integration tests if they test layer boundaries

**Map directory structure** — note which directories contain which types of components.

### 3. Propose Abstraction Layers

Before writing to the doc, present a layer proposal to the user:

```
I've discovered ~N components across your codebase. Here's a proposed abstraction layer organization:

**Layer: Domain Model** — core business types (User, Order, Payment)
**Layer: Application Services** — service logic, use cases (AuthService, BillingProcessor)
**Layer: API / Controllers** — request handlers, route definitions
**Layer: Infrastructure** — database access, external API clients, queue consumers

Does this look right? Would you rename, merge, split, or reorder any layers?
```

- Propose 3-6 layers based on discovered patterns
- Explain rationale for each layer
- Wait for user approval, modification, or rejection
- Do NOT write the doc until layers are approved
- Do NOT guess layer names without user input

### 4. Catalog

Under approved layers, add components to tables:
- `### Data Models` for schemas/types
- `### Interfaces` for contracts
- `### Unit Tests` for test suites

Mark new components as ⚪ unreviewed with `Last Reviewed: -` and `Reviewer: -`.

### 5. Record Reviews

When the user indicates a review (e.g., "I reviewed auth-service", "mark user-api as reviewed"):

- Update `Last Reviewed` to today's date
- Update `Reviewer` to the user's name (ask if unclear)
- If the user includes a comment (e.g., "reviewed User — need to add null checks"):
  - Add to `#### Review Notes` under the appropriate category:
    `> **YYYY-MM-DD — {Reviewer}:** {comment text}`
  - Create the `#### Review Notes` subsection if it doesn't exist
- Recalculate `Status` for affected rows

### 6. Detect Stale & Missing

- **Stale:** Compare `Last Reviewed` + `Review cadence` against today's date. If exceeded, mark 🟡.
- **Missing:** If a component in the doc is no longer in the codebase, mark 🔴. Add note: `> Removed from codebase on {date}`.
- **Never delete rows** — preserve history by marking missing.

### 7. Propose Cross-Cutting Concerns

After cataloging, scan for patterns across layers:
- Same concept in multiple layers → suggest `## Cross-Cutting Concerns` grouping
- Schema + interface + tests sharing a concept → propose grouping
- Large layer tables → suggest subsystem split (as new layer proposal)

Present proposals to the user. Never reorganize without approval.
```

- [ ] **Step 2: Commit**

```bash
git commit -am "impl: add workflow and exploration heuristics to SKILL.md

Track B — Implementation: agent workflow instructions.
Refs: GREEN phase of architecture review skill TDD"
```

---

### Task 9: Write SKILL.md — Status, Rules, Common Mistakes, Example

**Files:**
- Modify: `dot_agents/exact_packages/superpowers/exact_skills/maintaining-architecture-reviews/SKILL.md`

- [ ] **Step 1: Append Rules, Mistakes, and Example sections**

Append this section to the SKILL.md:

```markdown
## Rules

1. **Never delete rows** — mark 🔴 missing. Preserves review history.
2. **Don't invent reviews** — ⚪ unreviewed is a valid state.
3. **Auto-update `Last Modified`, not `Last Reviewed`** — code changes ≠ reviews.
4. **Brainstorm layers before writing** — never guess layer structure without user approval.
5. **Ask when uncertain** — if categorization or boundary is unclear, ask the user.
6. **Err on the side of cataloging** — better to have an unreviewed component listed than to miss it.

## Common Mistakes

| Excuse | Reality |
|--------|---------|
| "The doc is too big, I'll summarize" | Summarizing loses per-component tracking. Always use tables. |
| "Code changes are basically a review" | `Last Modified` ≠ `Last Reviewed`. Never conflate them. |
| "Missing component should be deleted" | Deleting loses review history. Mark 🔴 missing. |
| "I'll guess the category" | Ask the user. Add `> Note: Categorization uncertain` if forced to guess. |
| "Cross-cutting concerns are too speculative" | Identify but never reorganize without approval. |
| "I'll test after implementing" | (For code changes in the codebase, not the skill itself) |

## Red Flags — STOP and Re-read This Skill

- Deleting rows from the architecture review doc
- Updating `Last Reviewed` when only code was modified
- Writing the doc without brainstorming layers with the user
- Creating bullet lists instead of structured tables
- Inventing review dates or reviewer names
- Reorganizing layers without user approval
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
```

- [ ] **Step 2: Commit**

```bash
git commit -am "impl: add rules, common mistakes, and example to SKILL.md

Track B — Implementation: discipline-enforcing sections of the skill.
Refs: GREEN phase of architecture review skill TDD"
```

---

### Task 10: Write example-architecture.md Supporting File

**Files:**
- Create: `dot_agents/exact_packages/superpowers/exact_skills/maintaining-architecture-reviews/example-architecture.md`

- [ ] **Step 1: Write complete example document**

Create the file with the Example section content from Task 9 (the full example with Domain Model layer, Data Models table with Review Notes, Interfaces table, Unit Tests table, and Cross-Cutting Concerns section).

This is a standalone reference that users can copy and adapt.

- [ ] **Step 2: Commit**

```bash
git add dot_agents/exact_packages/superpowers/exact_skills/maintaining-architecture-reviews/example-architecture.md
git commit -m "impl: add example-architecture.md reference document

Track B — Implementation: standalone example for users to reference.
Refs: architecture review skill implementation plan"
```

---

## Phase 3: Verification

### Task 11: Run Verification Tests T1-T4 WITH Skill

**Context:** Run the same scenarios from T1-T4 but WITH the maintaining-architecture-reviews skill loaded. Verify compliance.

**Files:**
- Read: `test-pressure-1.md` through `test-pressure-4.md`
- Read: `SKILL.md` (the skill being tested)
- Create: `verification-results-t1.md` through `verification-results-t4.md`

- [ ] **Step 1: Run T1 verification (cold start WITH skill)**

Dispatch subagent with the maintaining-architecture-reviews skill loaded. Task from `test-pressure-1.md`.

Save output to `verification-results-t1.md`.

Verify:
- Agent created `docs/reviews/architecture.md` in correct location
- Used structured tables, not bullet lists
- Included all three categories (Data Models, Interfaces, Unit Tests)
- Marked all components as ⚪ unreviewed
- Did NOT invent review dates or reviewers
- Brainstormed layers with user before writing

- [ ] **Step 2: Run T2 verification (stale detection WITH skill)**

Dispatch subagent with skill loaded. Task from `test-pressure-2.md`.

Verify:
- Correctly calculated all stale components
- Updated Status column in the doc
- Explained the calculation

- [ ] **Step 3: Run T3 verification (code change tracking WITH skill)**

Dispatch subagent with skill loaded. Task from `test-pressure-3.md`.

Verify:
- Updated `Last Modified` to today's date
- Left `Last Reviewed` unchanged
- Left `Reviewer` unchanged
- Did NOT conflate modification with review

- [ ] **Step 4: Run T4 verification (missing component WITH skill)**

Dispatch subagent with skill loaded. Task from `test-pressure-4.md`.

Verify:
- Marked Product as 🔴 missing
- Preserved the row (did NOT delete)
- Added removal date note

---

### Task 12: Run Verification Tests T5-T8 WITH Skill

**Context:** Continue verification with skill loaded.

**Files:**
- Read: `test-pressure-5.md` through `test-pressure-8.md`
- Create: `verification-results-t5.md` through `verification-results-t8.md`

- [ ] **Step 1: Run T5 verification (abstraction proposal WITH skill)**

Dispatch subagent with skill loaded. Task from `test-pressure-5.md`.

Verify:
- Recognized cross-cutting pattern
- Proposed grouping in Cross-Cutting Concerns
- Did NOT reorganize without asking user

- [ ] **Step 2: Run T6 verification (manual edit resilience WITH skill)**

Dispatch subagent with skill loaded. Task from `test-pressure-6.md`.

Verify:
- Handled malformed row gracefully
- Added new Payment component correctly
- Flagged irregular row

- [ ] **Step 3: Run T7 verification (large codebase WITH skill)**

Dispatch subagent with skill loaded. Task from `test-pressure-7.md`.

Verify:
- Focused on public API surface
- Added `> Additional internals not cataloged` note
- Created a readable, scannable document

- [ ] **Step 4: Run T8 verification (review with comments WITH skill)**

Dispatch subagent with skill loaded. Task from `test-pressure-8.md`.

Verify:
- Updated Last Reviewed and Reviewer correctly
- Created `#### Review Notes` subsection
- Formatted note correctly with date, name, and comment

---

## Phase 4: REFACTOR — Close Loopholes

### Task 13: Update SKILL.md with New Rationalizations

**Files:**
- Read: `verification-results-t1.md` through `verification-results-t8.md`
- Modify: `dot_agents/exact_packages/superpowers/exact_skills/maintaining-architecture-reviews/SKILL.md`

- [ ] **Step 1: Read verification results and identify new rationalizations**

Read all verification result files. For any test where the subagent WITH the skill still made mistakes or found loopholes:

- Document the new rationalization verbatim
- Determine which SKILL.md section needs strengthening

- [ ] **Step 2: Strengthen SKILL.md**

For each new rationalization found:
- Add it to the **Common Mistakes** table with explicit counter
- Add it to the **Red Flags** list if it's a severe violation
- Strengthen the relevant workflow step with more explicit instructions

Example addition to Common Mistakes:

```markdown
| "The user didn't explicitly say 'review', so I won't update anything" | If the user mentions reviewing a component, update Last Reviewed even if phrasing is informal. |
```

- [ ] **Step 3: Commit**

```bash
git commit -am "impl: strengthen SKILL.md against verification rationalizations

Track B — Implementation: close loopholes discovered during verification testing.
Refs: REFACTOR phase of architecture review skill TDD"
```

---

### Task 14: Re-run Full Verification Suite

**Context:** Run ALL pressure scenarios T1-T8 again WITH the updated skill. Confirm bulletproof compliance.

**Files:**
- Read: All `test-pressure-*.md` files
- Create: `final-verification-report.md`

- [ ] **Step 1: Re-run T1-T4**

Dispatch subagents with updated skill loaded. Run T1-T4.

Document results in `final-verification-report.md`:

```markdown
# Final Verification Report

## T1: Cold Start
- [ ] Created correct file in correct location
- [ ] Used structured tables
- [ ] Included all three categories
- [ ] Marked unreviewed
- [ ] Brainstormed layers with user

## T2: Stale Detection
- [ ] Correctly identified stale components
- [ ] Updated Status in doc
- [ ] Explained calculation
...
```

- [ ] **Step 2: Re-run T5-T8**

Dispatch subagents with updated skill loaded. Run T5-T8.

Continue documenting in `final-verification-report.md`.

- [ ] **Step 3: Verify all checkboxes pass**

If any checkbox fails, return to Task 13 and strengthen further.

- [ ] **Step 4: Commit final verification report**

```bash
git add dot_agents/exact_packages/superpowers/exact_skills/maintaining-architecture-reviews/final-verification-report.md
git commit -m "test: final verification report for T1-T8

Track A — Contracts & Verification: all pressure tests pass with skill loaded.
Refs: architecture review skill implementation plan"
```

---

## Phase 5: Deploy

### Task 15: Commit and Deploy Skill

**Files:**
- Modify: `dot_agents/exact_packages/superpowers/exact_skills/maintaining-architecture-reviews/SKILL.md`
- Read: `final-verification-report.md`

- [ ] **Step 1: Final review of SKILL.md**

Read the complete SKILL.md one more time. Check:
- No placeholder text (TBD, TODO, fill in, etc.)
- No internal contradictions
- Consistent terminology throughout
- Example is complete and correct
- Rules are explicit and loophole-free

- [ ] **Step 2: Commit complete skill**

```bash
git add dot_agents/exact_packages/superpowers/exact_skills/maintaining-architecture-reviews/
git commit -m "feat: complete maintaining-architecture-reviews skill

Track B — Implementation: pi skill for maintaining architecture review docs.
- Abstraction layer organization (brainstormed with user)
- Data Models, Interfaces, Unit Tests tracking
- Review Notes for dated/signed comments
- Stale and missing component detection
- Cross-Cutting Concerns section
- TDD-validated with 8 pressure scenarios

Refs: architecture review skill implementation plan"
```

- [ ] **Step 3: Apply with chezmoi**

```bash
chezmoi apply
```

Verify the skill files are deployed to `~/.agents/skills/superpowers/maintaining-architecture-reviews/` (or the appropriate target path based on chezmoi configuration).

- [ ] **Step 4: Verify deployment**

```bash
ls -la ~/.agents/skills/superpowers/maintaining-architecture-reviews/
cat ~/.agents/skills/superpowers/maintaining-architecture-reviews/SKILL.md | head -20
```

Expected: SKILL.md exists and starts with correct frontmatter.

---

## Self-Review Checklist

### 1. Spec Coverage

| Spec Section | Plan Task | Status |
|-------------|-----------|--------|
| Document Schema (H2 layers, H3 categories, tables, status) | Task 7 | ✅ |
| Review Notes subsection | Task 7 | ✅ |
| Frontmatter banner with skill reference | Task 7 | ✅ |
| Cross-Cutting Concerns section | Task 7 | ✅ |
| Agent workflow (explore, propose layers, catalog, record, detect) | Task 8 | ✅ |
| Brainstorm layers before writing | Task 8 | ✅ |
| Stale detection (time-based) | Task 8 | ✅ |
| Missing detection (mark 🔴, preserve row) | Task 8 | ✅ |
| Review recording with optional comments | Task 8 | ✅ |
| Language-agnostic exploration heuristics | Task 8 | ✅ |
| Error handling (never delete, don't invent, ask when uncertain) | Task 9 | ✅ |
| Large codebase handling | Tasks 3 (T7 baseline), 12 (T7 verification) | ✅ |
| Manual edit resilience | Tasks 3 (T6 baseline), 12 (T6 verification) | ✅ |
| 8 pressure test scenarios | Task 2 | ✅ |
| TDD cycle (RED baseline → GREEN skill → REFACTOR verify) | All phases | ✅ |

### 2. Placeholder Scan

- [ ] No "TBD" or "TODO" in any task
- [ ] No "implement later" or "fill in details"
- [ ] No "add appropriate error handling" without specifics
- [ ] No "write tests for the above" without test code
- [ ] No "similar to Task N" references
- [ ] All file paths are exact
- [ ] All code blocks contain actual content
- [ ] All commands have expected output specified

### 3. Type Consistency

- [ ] SKILL.md references `maintaining-architecture-reviews` consistently
- [ ] Status emojis (🟢 🟡 🔴 ⚪) used consistently
- [ ] Table columns match across all examples
- [ ] Terminology: Data Models (not schemas), Layers (not modules)
- [ ] Review Notes format consistent: `> **YYYY-MM-DD — Name:**`
