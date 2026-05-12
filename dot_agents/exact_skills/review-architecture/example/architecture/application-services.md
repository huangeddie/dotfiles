---
layer: Application Services
rating: 3 Rough
reviewed: 2024-03-22
note: Boundaries are blurry; AuthService and OrderService share too much state.
---

# Application Services

### Data Models

_None yet._

### Interfaces

- `class AuthService` — 4 Adequate
  - File: `src/services.ts`
  - Reviewed: 2024-01-15
  - Modified: 2024-03-20

- `class OrderService` — ⚪ Unreviewed
  - File: `src/services.ts`
  - Reviewed: —
  - Modified: 2024-03-18

- `class PaymentProcessor` — ⚪ Unreviewed
  - File: `src/payments.ts`
  - Reviewed: —
  - Modified: 2024-03-19

### Unit Tests

- **AuthServiceTests** — 4 Adequate
  - Scope: Login/logout
  - File: `src/services.test.ts`
  - Reviewed: 2024-01-15
  - Modified: 2024-03-20

- **OrderServiceTests** — ⚪ Unreviewed
  - Scope: Create/cancel
  - File: `src/services.test.ts`
  - Reviewed: —
  - Modified: 2024-03-18
