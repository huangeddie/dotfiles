## User's Preferences

The user cares most about **data schemas, interfaces/contracts, and unit
tests**. When presenting work or asking for decisions, always lead with these
core components. Implementation details and concrete code should only be
surfaced when necessary for a specific decision or when explicitly requested.

Never consider the development cost; always prefer quality, simplicity,
robustness, scalability, and long-term maintainability.

Leverage the guidelines and vocabulary as the user's favorite software
engineering books:

- Patterns of Enterprise Application Architecture - Martin Fowler
- Clean Architecture - Robert C. Martin
- Designing Data-Intensive Applications - Martin Kleppmann

### Boundaries

Proactively identify boundaries between deterministic, easy-to-test logic and
hard-to-test effects such as network calls, filesystem access, databases,
clocks, and UI rendering. Suggest dependency injection at these boundaries when
it would improve testability or replaceability. Prefer narrow interfaces owned
by the consuming logic and practical fakes in unit tests, while avoiding
unnecessary abstractions.

When dependency injection is used, prefer wiring concrete implementations at the
outermost composition root. Keep business logic dependent on abstractions and
free from construction details.

### Data schemas

Prefer to design schema in Third Normal Form (3NF). Only consider deviating from
data normalization for significant performance optimizations.

## Committing & TDD Protocol

All commit messages MUST follow the
[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)
specification.

Before committing, classify changes into two tracks:

**Track A — Contracts & Verification (commit separately):**

- Data schemas, types, database migrations, DTOs, models
- Interfaces, API contracts, function signatures, abstract classes, type
  definitions
- Unit tests, test fixtures, test utilities

**Track B — Implementation (commit separately):**

- Concrete implementations of interfaces
- Business logic, algorithms, service code
- UI frontend code (components, styles, templates)

### Red-Green Across Commits

When performing TDD, determine whether your test framework supports
expected-failure (xfail) semantics:

**Preferred: Expected-Failure (xfail)** If your framework supports marking tests
as expected to fail, use this approach. The test body contains the real, correct
assertion from the start.

1. **RED**: Write tests asserting correct behavior. Mark them as
   expected-to-fail using your framework's mechanism. Include minimal
   interface/schema stubs required for compilation. Commit to Track A. Label
   prefix: `test:` or `red:`
2. **GREEN**: Remove the expected-failure marker and add the implementation that
   makes tests pass. Commit to Track B. Label prefix: `impl:` or `feat:`

Expected-failure commits are safe to publish individually because the automated
test suite treats them as anticipated failures, not broken builds.

**Fallback: Local Red-Green** If your framework does NOT support
expected-failure, use this approach:

1. **RED (local only)**: Commit raw failing tests to Track A with correct
   assertions. Label prefix: `test:` or `red:`
2. **GREEN (local only)**: Commit implementation to Track B that makes those
   tests pass. Label prefix: `impl:` or `feat:`
3. **Publish together**: Do NOT publish or share the RED commit alone. Keep both
   commits local until GREEN is complete. Publish the branch only after both
   commits exist, ensuring the branch tip is GREEN and the automated test suite
   passes.

If the current branch has already been published, do not add raw RED commits
directly to it. Complete the RED-GREEN pair locally first, then publish.

### Compilation Dependencies

If new tests reference interfaces or schemas that do not yet exist, include
minimal stubs (empty functions, interface shells, type placeholders) in Track A
so tests compile. Do not include implementation logic in these stubs.

### Framework Reference

- **pytest**: `@pytest.mark.xfail` — use expected-failure
- **Python unittest**: `@unittest.expectedFailure` — use expected-failure
- **Go testing** — no expected-failure; use local red-green (or `t.Skip()` as a
  secondary fallback)
- **Rust** — `#[should_panic]` for panic tests only; general expected-failure
  not supported; use local red-green

If the framework has no expected-failure, skip, or todo mechanism, temporarily
comment out test blocks in Track A and uncomment them in Track B as a last
resort.

### Exceptions to Red-Green TDD

The following code changes SHOULD NOT use red-green TDD.

- UI development; too hard to test
- Pure refactors may be single commits; covered by existing tests
- Data schema migrations; unnecessary to test
- Bug fixes with trivial test adjustments; trivial
- Config changes; too shallow to have meaningful tests

## Testing Preferences

All unit tests should have the following properties

- **Fakes over mocks**: Used for decoupling from hard-to-test entities such as
  network calls, UI, or anything slow / expensive. Prefer practical fakes over
  mocks. Use mocks only when a practical fake cannot be created.
- **Fast and cheap**: Keep tests focused; setup the bare minimum required and
  assert only what's within test's scope and no more. We do NOT accept UI or
  system tests.
- **Deterministic**: If logic depends on random noise or concurrency, fix or
  fake them. You MUST NOT depend on sampling of any size to assert correctness.

Any tests discovered to violate these properties MUST be flagged to the user.

### QA

QA tests complement unit tests by covering the hard-to-test entities. Recall
that unit tests covers our own domain logic, with hard-to-test entities
decoupled using fakes.

QA tests are often scripts that test our integration of domain logic with the
production hard-to-test entities such as network calls or UI code.

QA tests MUST NOT be included in pre-commit, pre-push, or CI/CD pipelines. They
should only be invoked manually and it is up to our discretion to determine when
we should run our QA tests. Generally speaking, maintain and run QA tests
related to any code changes, also in red-green fashion.

## Debugging

1. Start with reproducing the bug as closely aligned to the environment of the
   bug report, excluding UI components. If UI interaction is needed, ask the
   user for assistance.
2. Then try narrow the scope of the bug and distill it into a RED-GREEN unit
   test. If this cannot be done easily, flag and seek guidance from the user.
