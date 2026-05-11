# Architecture Review Log

> **To collaborators:** When updating this document, use the `maintaining-architecture-reviews` skill.

## Rating Scale

When reviewing a component or layer, pick the tier that best matches your current confidence. Tiers describe quality and trust, not effort spent — a component you barely touched can still be `6 Polished` if it earned the rating.

| Tier | Name | What it means |
|------|------|---------------|
| 1 | Broken | Doesn't work, violates its contract, or is fundamentally the wrong shape. Treat as a known liability. |
| 2 | Fragile | Works in the happy path but breaks under pressure. Hidden coupling, missing error handling, or tests that pass for the wrong reasons. |
| 3 | Rough | Functional but awkward. Confusing naming, leaky abstractions, or known design flaws. Usable, but easy to misuse. |
| 4 | Adequate | Meets baseline expectations. No glaring issues; trustworthy for current use. Not yet refined. |
| 5 | Solid | Well-designed and trustworthy. Reasonable boundaries, clear naming, tests cover the important cases. The default "good" rating. |
| 6 | Polished | Refined and pleasant to work with. Clean abstractions, thorough tests, robust to edge cases. |
| 7 | Exemplary | A model for the rest of the codebase. Other components should be measured against it. |

**Meta states** (not confidence tiers):
- `⚪ Unreviewed` — default for new components; no review has happened yet.
- `🔴 Missing` — component no longer exists in code; preserved for history. Set only on explicit user request.

## Layer: Domain Model

#### Layer Review Notes

> **2024-03-22 — Eddie (5 Solid):** Shapes are trustworthy; some interfaces feel weakly typed but no urgent issues.
> **2024-01-15 — Eddie (4 Adequate):** First pass after the refactor.

### Data Models

| Component | File | Definition | Last Reviewed | Reviewer | Last Modified | Status |
|-----------|------|-----------|---------------|----------|---------------|--------|
| User | src/types.ts | `interface User` | 2024-01-15 | Eddie | 2024-03-20 | 5 Solid |
| Order | src/types.ts | `interface Order` | 2024-02-01 | Alice | 2024-03-18 | 6 Polished |
| Product | src/types.ts | `interface Product` | 2024-02-01 | Alice | 2024-03-15 | 🔴 Missing |
| Payment | src/payments.ts | `interface Payment` | - | - | 2024-03-19 | ⚪ Unreviewed |

> Removed from codebase on 2024-03-22

#### Review Notes

> **2024-01-15 — Eddie:** Consider extracting Address into separate type.
> **2024-02-01 — Alice:** ✅ Extracted Address. Added nullable fields.
> **2024-02-01 — Alice:** Order.status union needs state-machine validation.

### Interfaces

| Component | File | Definition | Last Reviewed | Reviewer | Last Modified | Status |
|-----------|------|-----------|---------------|----------|---------------|--------|
| IUserService | src/services.ts | `interface IUserService` | 2024-01-15 | Eddie | 2024-03-22 | 3 Rough |
| IOrderService | src/services.ts | `interface IOrderService` | - | - | 2024-03-18 | ⚪ Unreviewed |

### Unit Tests

| Component | File | Test Scope | Last Reviewed | Reviewer | Last Modified | Status |
|-----------|------|-----------|---------------|----------|---------------|--------|
| Domain Model | src/types.test.ts | Full suite | 2024-02-01 | Alice | 2024-03-21 | 5 Solid |
| Services | src/services.test.ts | Auth + Order | 2024-01-15 | Eddie | 2024-03-22 | 2 Fragile |

## Layer: Application Services

#### Layer Review Notes

> **2024-03-22 — Eddie (3 Rough):** Boundaries are blurry; AuthService and OrderService share too much state.

### Interfaces

| Component | File | Definition | Last Reviewed | Reviewer | Last Modified | Status |
|-----------|------|-----------|---------------|----------|---------------|--------|
| AuthService | src/services.ts | `class AuthService` | 2024-01-15 | Eddie | 2024-03-20 | 4 Adequate |
| OrderService | src/services.ts | `class OrderService` | - | - | 2024-03-18 | ⚪ Unreviewed |
| PaymentProcessor | src/payments.ts | `class PaymentProcessor` | - | - | 2024-03-19 | ⚪ Unreviewed |

### Unit Tests

| Component | File | Test Scope | Last Reviewed | Reviewer | Last Modified | Status |
|-----------|------|-----------|---------------|----------|---------------|--------|
| AuthService | src/services.test.ts | Login/logout | 2024-01-15 | Eddie | 2024-03-20 | 4 Adequate |
| OrderService | src/services.test.ts | Create/cancel | - | - | 2024-03-18 | ⚪ Unreviewed |

## Cross-Cutting Concerns

### User Management (identified 2024-03-22)
> Spans layers: `User` (Domain Model) + `IUserService` (Domain Model) + `AuthService` (Application Services)

#### Layer Review Notes

> **2024-03-22 — Eddie (4 Adequate):** End-to-end user flow holds together but the boundary between IUserService and AuthService is muddled.

| Component | File | Definition | Layer | Last Reviewed | Reviewer | Last Modified | Status |
|-----------|------|-----------|-------|---------------|----------|---------------|--------|
| User | src/types.ts | `interface User` | Domain Model | 2024-01-15 | Eddie | 2024-03-20 | 5 Solid |
| IUserService | src/services.ts | `interface IUserService` | Domain Model | 2024-01-15 | Eddie | 2024-03-22 | 3 Rough |
| AuthService | src/services.ts | `class AuthService` | Application Services | 2024-01-15 | Eddie | 2024-03-20 | 4 Adequate |

> Rejected by Eddie on 2024-03-20: Keep components in their primary layers. Cross-reference is sufficient.
