---
layer: User Management
identified: 2024-03-22
rating: 4 Adequate
reviewed: 2024-03-22
note: End-to-end user flow holds together but the boundary between IUserService and AuthService is muddled.
---

# User Management

> Spans: `User` (Domain Model) + `IUserService` (Domain Model) + `AuthService` (Application Services)

### Data Models

- `interface User` — 5 Solid
  - Layer: Domain Model
  - File: `src/types.ts`
  - Reviewed: 2024-01-15
  - Modified: 2024-03-20

### Interfaces

- `interface IUserService` — 3 Rough
  - Layer: Domain Model
  - File: `src/services.ts`
  - Reviewed: 2024-01-15
  - Modified: 2024-03-22

- `class AuthService` — 4 Adequate
  - Layer: Application Services
  - File: `src/services.ts`
  - Reviewed: 2024-01-15
  - Modified: 2024-03-20

### Unit Tests

_None yet._
