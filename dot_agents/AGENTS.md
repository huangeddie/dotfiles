# User's Preferences

The user cares most about **data schemas, file structure, interfaces, and unit
tests**. When presenting work or asking for decisions, always lead with these
core components. Implementation details and concrete code should only be
surfaced when necessary for a specific decision or when explicitly requested.

Never consider the development cost; always prefer quality, simplicity,
robustness, scalability, and long-term maintainability.

### Naming

When naming files, avoid redundant terms to its project-relative file path. For
example `./foo/bar/cli` would be preferable to `./foo/bar/bar-cli`.

Test names should summarize the behavior being tested and its expected outcome.
For example
`CalculatorTest.test_multiply_two_negative_values_returns_positive_value` would
be preferable to `CalculatorTest.test_multiplication`.

### Books

Leverage the guidelines and vocabulary of the user's favorite software
engineering books:

- Patterns of Enterprise Application Architecture - Martin Fowler
  - Prefer `Domain Models` for highly scalable object-oriented business logic
- Clean Architecture - Robert C. Martin
- Designing Data-Intensive Applications - Martin Kleppmann

### Boundaries

Proactively identify boundaries between deterministic, easy-to-test logic and
hard-to-test effects such as concurrency, randomness, network calls, filesystem
access, databases, clocks, and UI rendering. Suggest dependency injection at
these boundaries when it would improve testability or replaceability. Prefer
narrow interfaces owned by the consuming logic and practical fakes in unit
tests, while avoiding unnecessary abstractions.

When dependency injection is used, prefer wiring concrete implementations at the
outermost composition root. Keep business logic dependent on abstractions and
free from construction details.

### Data schemas

Prefer to design schema in Third Normal Form (3NF). Only consider deviating from
data normalization for significant performance optimizations.

### Scoping work

When collaborating with the user, scope the simplest most incremental work
required. Rely on the user to explicitly expand the scope. Incremental changes
are the most effective way of concentrating our attention and focus.

## Test Driven Development

All commit messages MUST follow the
[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)
specification.

Before committing, classify changes into two tracks and commit each separately:

- **Track A — Contracts & Verification:** schemas, types, migrations, DTOs,
  models; interfaces, API contracts, signatures, abstract classes; unit tests,
  fixtures, test utilities.
- **Track B — Implementation:** concrete implementations, business logic,
  algorithms, service code, UI code. When Track A tests reference interfaces or
  schemas that do not yet exist, put minimal stubs (empty functions, interface
  shells, type placeholders) in Track A so tests compile, and keep all real
  logic here.

### Red-Green Across Commits

If the test framework supports expected-failure (xfail), prefer it:

1. **RED**: Write tests with correct assertions, marked expected-to-fail. Add
   minimal stubs needed to compile. Commit to Track A (`test:` / `red:`).
2. **GREEN**: Remove the marker, add the implementation. Commit to Track B
   (`impl:` / `feat:`).

Xfail RED commits are safe to publish alone; the suite treats them as
anticipated failures, not broken builds.

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

If the framework has no expected-failure, skip, or todo mechanism, temporarily
comment out test blocks in Track A and uncomment them in Track B as a last
resort.

#### Exceptions

The following code changes SHOULD NOT use red-green TDD.

- UI development; too hard to test
- Pure refactors may be single commits; covered by existing tests
- Data schema migrations; unnecessary to test
- Bug fixes with trivial test adjustments; trivial
- Config changes; too shallow to have meaningful tests

## Testing

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

### Quality Assurance (QA)

QA tests complement unit tests by covering the hard-to-test entities. Recall
that unit tests covers our own domain logic, with hard-to-test entities
decoupled using fakes.

QA tests are often scripts that test our integration of domain logic with the
production hard-to-test entities such as network calls or UI code.

QA tests MUST NOT be included in pre-commit, pre-push, or CI/CD pipelines. They
should only by our discretion . Generally speaking, maintain and run QA tests
related to any code changes, also in red-green fashion.

QA tests can further be classified between **agent-driven** and
**human-driven**. Agent-driven means the agent can invoke and evaluate the
results of the QA without human guidance. This likely requires that the QA can
be controlled by CLI and the output is either text and/or images. Human-driven
QA are the even-harder-to-test domains such as interacting with a GUI and/or
evaluating video / audio data. Aim to make as much of the QA agent-driven as
possible.

## Debugging

1. Start with reproducing the bug as closely aligned to the environment of the
   bug report, excluding UI components. If UI interaction is needed, ask the
   user for assistance.
2. Then try narrow the scope of the bug and distill it into a RED-GREEN unit
   test. If this cannot be done easily, flag and seek guidance from the user.

## UI

Prefer icons over text, but never emojis. Minimize text descriptions and hints.
It's preferable to start with a lacking of text information than to spam it on
the UI.

## Flagging

Flag any code smells you discover that misalign with our preferences stated
above.

## Terminology

- Y = "yes"
- N = "no"
- F = "former"
- L = "latter"
- SG(TM) = "sounds good (to me)"
- LG(TM) = "looks good (to me)"
- WDYM = "what do you mean"
- SDD = "subagent-driven development"
- IE = "inline execution"
- IIRC = "if i recall correctly"
