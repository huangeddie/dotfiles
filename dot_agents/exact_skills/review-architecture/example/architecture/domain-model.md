---
layer: Domain Model
rating: 5 Solid
reviewed: 2024-03-22
note: Shapes are trustworthy; some interfaces feel weakly typed but no urgent issues.
---

# Domain Model

### Data Models

- `interface User` — 5 Solid
  - File: `src/types.ts`
  - Reviewed: 2024-01-15
  - Modified: 2024-03-20

- `interface Order` — 6 Polished
  - File: `src/types.ts`
  - Reviewed: 2024-02-01
  - Modified: 2024-03-18

- `interface Product` — 🔴 Missing
  - File: `src/types.ts`
  - Reviewed: 2024-02-01
  - Modified: 2024-03-15

  > Removed from codebase on 2024-03-22

- `interface Payment` — ⚪ Unreviewed
  - File: `src/payments.ts`
  - Reviewed: —
  - Modified: 2024-03-19

#### Review Notes

> **2024-01-15:** Consider extracting Address into separate type.
> **2024-02-01:** ✅ Extracted Address. Added nullable fields.
> **2024-02-01:** Order.status union needs state-machine validation.

### Interfaces

- `interface IUserService` — 3 Rough
  - File: `src/services.ts`
  - Reviewed: 2024-01-15
  - Modified: 2024-03-22

- `interface IOrderService` — ⚪ Unreviewed
  - File: `src/services.ts`
  - Reviewed: —
  - Modified: 2024-03-18

### Unit Tests

- **DomainModelTests** — 5 Solid
  - Scope: Full suite for User/Order/Payment
  - File: `src/types.test.ts`
  - Reviewed: 2024-02-01
  - Modified: 2024-03-21

- **ServicesTests** — 2 Fragile
  - Scope: Auth + Order
  - File: `src/services.test.ts`
  - Reviewed: 2024-01-15
  - Modified: 2024-03-22
