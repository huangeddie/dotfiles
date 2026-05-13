# Architecture Review Log

## Rating Scale

When reviewing a component or layer, pick the tier that best matches your current confidence. Tiers describe quality and trust, not effort spent — a component you barely touched can still be `6 Polished` if it earned the rating.

**Confidence tiers** (set only by an explicit review):

- **1 Broken** — Doesn't work, violates its contract, or is fundamentally the wrong shape. Treat as a known liability.
- **2 Fragile** — Works in the happy path but breaks under pressure. Hidden coupling, missing error handling, or tests that pass for the wrong reasons.
- **3 Rough** — Functional but awkward. Confusing naming, leaky abstractions, or known design flaws. Usable, but easy to misuse.
- **4 Adequate** — Meets baseline expectations. No glaring issues; trustworthy for current use. Not yet refined.
- **5 Solid** — Well-designed and trustworthy. Reasonable boundaries, clear naming, tests cover the important cases. The default "good" rating.
- **6 Polished** — Refined and pleasant to work with. Clean abstractions, thorough tests, robust to edge cases.
- **7 Exemplary** — A model for the rest of the codebase. Other components should be measured against it.

**Meta states** (not confidence tiers):

- `⚪ Unreviewed` — default for new components; no review has happened yet.
- `🔴 Missing` — component no longer exists in code; preserved for history. Set only on explicit user request.

## Layers

### [Domain Model](layers/domain-model.md) — 5 Solid (reviewed 2024-03-22)

> Shapes are trustworthy; some interfaces feel weakly typed but no urgent issues.

### [Application Services](layers/application-services.md) — 3 Rough (reviewed 2024-03-22)

> Boundaries are blurry; AuthService and OrderService share too much state.

## Cross-Cutting Concerns

### [User Management](cross-cutting/user-management.md) — 4 Adequate (reviewed 2024-03-22)

> Spans: `User` (Domain Model) + `IUserService` (Domain Model) + `AuthService` (Application Services)
>
> End-to-end user flow holds together but the boundary between IUserService and AuthService is muddled.
