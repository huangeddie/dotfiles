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
