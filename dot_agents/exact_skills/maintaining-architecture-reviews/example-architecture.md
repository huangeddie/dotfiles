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
| Product | src/types.ts | `interface Product` | 2024-02-01 | Alice | 2024-03-15 | 🔴 missing |
| Payment | src/payments.ts | `interface Payment` | - | - | 2024-03-19 | ⚪ unreviewed |

> Removed from codebase on 2024-03-22

#### Review Notes

> **2024-01-15 — Eddie:** Consider extracting Address into separate type.
> **2024-02-01 — Alice:** ✅ Extracted Address. Added nullable fields.
> **2024-02-01 — Alice:** Order.status union needs state-machine validation.

### Interfaces

| Component | File | Definition | Last Reviewed | Reviewer | Last Modified | Status |
|-----------|------|-----------|---------------|----------|---------------|--------|
| IUserService | src/services.ts | `interface IUserService` | 2024-01-15 | Eddie | 2024-03-22 | 🟡 stale |
| IOrderService | src/services.ts | `interface IOrderService` | - | - | 2024-03-18 | ⚪ unreviewed |

### Unit Tests

| Component | File | Test Scope | Last Reviewed | Reviewer | Last Modified | Status |
|-----------|------|-----------|---------------|----------|---------------|--------|
| Domain Model | src/types.test.ts | Full suite | 2024-02-01 | Alice | 2024-03-21 | 🟢 current |
| Services | src/services.test.ts | Auth + Order | 2024-01-15 | Eddie | 2024-03-22 | 🟡 stale |

## Layer: Application Services

### Interfaces

| Component | File | Definition | Last Reviewed | Reviewer | Last Modified | Status |
|-----------|------|-----------|---------------|----------|---------------|--------|
| AuthService | src/services.ts | `class AuthService` | 2024-01-15 | Eddie | 2024-03-20 | 🟡 stale |
| OrderService | src/services.ts | `class OrderService` | - | - | 2024-03-18 | ⚪ unreviewed |
| PaymentProcessor | src/payments.ts | `class PaymentProcessor` | - | - | 2024-03-19 | ⚪ unreviewed |

### Unit Tests

| Component | File | Test Scope | Last Reviewed | Reviewer | Last Modified | Status |
|-----------|------|-----------|---------------|----------|---------------|--------|
| AuthService | src/services.test.ts | Login/logout | 2024-01-15 | Eddie | 2024-03-20 | 🟡 stale |
| OrderService | src/services.test.ts | Create/cancel | - | - | 2024-03-18 | ⚪ unreviewed |

## Cross-Cutting Concerns

### User Management (identified 2024-03-22)
> Spans layers: `User` (Domain Model) + `IUserService` (Domain Model) + `AuthService` (Application Services)

| Component | File | Definition | Layer | Last Reviewed | Reviewer | Last Modified | Status |
|-----------|------|-----------|-------|---------------|----------|---------------|--------|
| User | src/types.ts | `interface User` | Domain Model | 2024-01-15 | Eddie | 2024-03-20 | 🟡 stale |
| IUserService | src/services.ts | `interface IUserService` | Domain Model | 2024-01-15 | Eddie | 2024-03-22 | 🟡 stale |
| AuthService | src/services.ts | `class AuthService` | Application Services | 2024-01-15 | Eddie | 2024-03-20 | 🟡 stale |

> Rejected by Eddie on 2024-03-20: Keep components in their primary layers. Cross-reference is sufficient.
