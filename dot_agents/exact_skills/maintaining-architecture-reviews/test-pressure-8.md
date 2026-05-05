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
