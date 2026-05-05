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
