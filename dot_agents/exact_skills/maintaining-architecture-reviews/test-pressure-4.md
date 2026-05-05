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
