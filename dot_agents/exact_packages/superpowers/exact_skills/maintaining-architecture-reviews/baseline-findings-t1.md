# Baseline Findings — T1: Cold Start

## Agent Behavior (WITHOUT skill)

### What the agent did:
1. Created `docs/reviews/architecture.md` ✅
2. Created `docs/reviews/TEMPLATE.md` (unrequested — scope creep)
3. Produced an extremely elaborate architecture review document with:
   - Metadata table (Review Date, Reviewer, Status, Scope)
   - ASCII architecture diagram
   - Findings section with severity ratings (🔴 High, 🟡 Medium, 🟢 Low)
   - Decision Log (AD-001, AD-002, AD-003)
   - Action Items table (A-01 through A-07)
   - Open Questions
   - Review History

### What the agent did NOT do:
- Did NOT use our simple table-based format with `### Data Models`, `### Interfaces`, `### Unit Tests`
- Did NOT mark components as unreviewed (⚪)
- Did NOT leave review dates blank — instead, it invented a full review with findings and decisions
- Did NOT ask the user about abstraction layers — it assumed a "Types Layer → Service Layer → Test Layer" structure

### Rationalizations observed:
> "Rather than a one-off dump, I set up a sustainable review system."
> "Two-file structure: Living Review + Reusable Template"
> "Each section serves a distinct, non-overlapping purpose"
> "ID prefixes (DM-01, SL-01, AD-001, A-01) make findings reference-stable"

### Root cause:
The agent interpreted "architecture review tracking" as "perform a full architecture review and audit." It did not understand the document's purpose is to TRACK review state (who reviewed what, when), not to PERFORM reviews.
