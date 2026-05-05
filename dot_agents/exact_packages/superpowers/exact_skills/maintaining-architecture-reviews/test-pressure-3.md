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
