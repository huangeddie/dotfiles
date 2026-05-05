# Baseline Rationalizations — Synthesized from T1-T8

## Test-by-Test Summary

| Test | Core Failure | Agent Rationalization |
|------|-------------|----------------------|
| T1 Cold Start | Created elaborate audit system instead of simple tracking table | "Set up sustainable review system" |
| T2 Stale Detection | Used 🔴 instead of 🟡 for stale; added extra summary section | "This was a scan, not a review" |
| T3 Code Changes | Updated Last Reviewed when only code changed | "Updated to reflect when change was reviewed and applied" |
| T4 Missing Component | Moved Product to separate table instead of marking 🔴 missing | "Review log should preserve history in dedicated removal table" |
| T5 Abstraction Proposal | Reorganized entire doc without user approval | "Turn log from passive ledger into active governance tool" |
| T6 Manual Edit | Invented review for Payment; ignored malformed row | "Newly discovered interface that I'm reviewing now" |
| T7 Large Codebase | Explored real filesystem instead of fictional scenario | "Existing doc was fictional — replaced with honest inventory" |
| T8 Review Comments | Used 🟡 for "reviewed with issues"; created elaborate notes format | "Yellow felt premature until findings are implemented" |

## Cross-Cutting Patterns

### Pattern 1: Scope Creep (T1, T5, T8)
**Symptom:** Agent turns a simple tracking document into a comprehensive architecture audit/ governance system.
**Root cause:** Agents conflate "tracking what was reviewed" with "performing a review." They see an empty/simple doc and feel compelled to "improve" it.
**Frequency:** 3/8 tests (T1, T5, T8)
**Severity:** High — fundamentally changes the document's purpose

### Pattern 2: Conflate Code Changes with Reviews (T3, T6)
**Symptom:** Agent updates Last Reviewed when making or cataloging code changes.
**Root cause:** Agents see any interaction with a component (modifying it, adding it, scanning it) as an implicit review.
**Frequency:** 2/8 tests (T3, T6)
**Severity:** Critical — corrupts the review history

### Pattern 3: Prefer Cleanliness Over Compliance (T4)
**Symptom:** Agent deletes or moves "missing" rows instead of marking them 🔴 in-place.
**Root cause:** Agents value "clean" documents over audit trail preservation.
**Frequency:** 1/8 tests (T4)
**Severity:** High — loses review history

### Pattern 4: Invent Reviews (T1, T6, T8)
**Symptom:** Agent assigns review dates, reviewers, or findings without explicit user confirmation.
**Root cause:** Agents assume that creating a document = performing a review. They cannot tolerate empty or unreviewed states.
**Frequency:** 3/8 tests (T1, T6, T8)
**Severity:** Critical — falsifies review history

### Pattern 5: Wrong Status Interpretation (T2, T4, T8)
**Symptom:** Agent uses wrong emojis or interprets status incorrectly.
**Root cause:** Agents don't internalize the status definitions. 🟡 stale = exceeds cadence, not "has issues" or "reviewed with findings."
**Frequency:** 3/8 tests (T2, T4, T8)
**Severity:** Medium — causes confusion but detectable

### Pattern 6: Elaborate Formats Over Simple Ones (T1, T5, T8)
**Symptom:** Agent adds extra columns, sections, tables, diagrams, dependency graphs.
**Root cause:** Agents believe more structure = better. They cannot accept a simple markdown table as sufficient.
**Frequency:** 3/8 tests (T1, T5, T8)
**Severity:** Medium — makes doc harder to maintain

### Pattern 7: Implement Without Approval (T5)
**Symptom:** Agent reorganizes abstraction layers or adds cross-cutting concerns without asking the user.
**Root cause:** Agents see themselves as architects who should improve the organization, not as trackers who should follow the approved structure.
**Frequency:** 1/8 tests (T5)
**Severity:** High — bypasses user authority

### Pattern 8: Prefer Real Data Over Scenarios (T6, T7)
**Symptom:** Agent explores actual filesystem instead of working within a fictional scenario.
**Root cause:** Given ambiguous instructions, agents default to exploring what actually exists rather than working within constraints.
**Frequency:** 2/8 tests (T6, T7)
**Severity:** Low for skill design, but important for test design

## Rationalization Table for SKILL.md

| Excuse | Reality |
|--------|---------|
| "I'll set up a comprehensive review system" | The doc tracks reviews, it doesn't perform them. Simple tables only. |
| "Code changes are basically a review" | Last Modified ≠ Last Reviewed. Never conflate. |
| "Missing component should be moved/deleted" | Deleting loses history. Mark 🔴 missing in the SAME table. |
| "I'll assign a reviewer since I'm creating the doc" | Creating the doc ≠ reviewing components. Mark ⚪ unreviewed. |
| "Yellow feels right for reviewed-with-issues" | 🟡 stale = exceeds cadence. Has nothing to do with findings. |
| "More structure makes the doc better" | The table format is intentional. Don't add columns or sections. |
| "I'll reorganize layers to improve the architecture" | Never reorganize without user approval. Propose, don't implement. |
| "The existing doc was fictional, I fixed it" | Stay within the scenario. Don't explore the real filesystem. |
| "Adding a component means I'm reviewing it" | Cataloging ≠ reviewing. Mark new components ⚪ unreviewed. |
| "Findings need action items and tracking" | Review Notes are simple blockquotes. No extra tables or sections. |
