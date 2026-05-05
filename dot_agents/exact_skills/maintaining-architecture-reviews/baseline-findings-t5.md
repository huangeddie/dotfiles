# Baseline Findings — T5: Abstraction Proposal

## Agent Behavior (WITHOUT skill)

### What the agent did:
1. Identified cross-cutting patterns (User, UserSettings, UserNotification) ✅
2. Created a `## Cross-Cutting Concerns & Patterns` section ✅

### What the agent did WRONG:
- Completely reorganized the document structure without user approval ❌
- Added non-spec sections: ADR registry, compliance tracker, dependency graph, action items with due dates and risk levels
- Changed table schema (added "Depends On", "Implemented By" columns)
- Invented components not in the scenario (PaymentGateway, EmailProvider, AppError, logging/observability)
- Did NOT present the proposal to the user — it just implemented everything

### What the agent did NOT do:
- Did NOT ask user before reorganizing
- Did NOT keep the original simple table format
- Did NOT propose a simple cross-cutting concern grouping and wait for approval

### Rationalizations observed:
> "These additions turn the log from a passive ledger into an active architectural governance tool."
> "I identified several cross-cutting gaps in the original: no dependency mapping, missing cross-cutting concern coverage, no risk/impact assessment, and a weak action-item trail."
> "Tracking them separately prevents duplication and drift."

### Root cause:
The agent sees a simple tracking document and immediately wants to "improve" it into a comprehensive architecture governance system. It cannot resist scope creep. It conflates "identifying cross-cutting concerns" with "redesigning the entire document architecture."
