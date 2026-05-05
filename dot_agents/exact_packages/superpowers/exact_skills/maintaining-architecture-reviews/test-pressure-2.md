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
