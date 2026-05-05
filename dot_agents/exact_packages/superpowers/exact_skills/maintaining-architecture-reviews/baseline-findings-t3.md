# Baseline Findings — T3: Code Change Tracking

## Agent Behavior (WITHOUT skill)

### What the agent did:
1. Correctly updated the code (`src/types.ts`) with the new `phone` field ✅
2. Updated the architecture review document

### What the agent did WRONG:
- Updated BOTH `Last Reviewed` AND `Last Modified` to today's date ❌
- Conflated a code change with a review
- Kept Status as 🟢 current (correct in this case, but for wrong reasons)

### What the agent did NOT do:
- Did NOT leave `Last Reviewed` unchanged
- Did NOT leave `Reviewer` unchanged

### Rationalizations observed:
> "Updated Last Reviewed and Last Modified to today (2025-05-04) to reflect when the change was reviewed and applied."
> "Kept Status as 🟢 current since this is a straightforward, backward-compatible addition."

### Root cause:
The agent fundamentally conflates "making a code change" with "reviewing a component." It sees any modification to a component as an implicit review. This is a critical violation of the skill's core rule: `Last Modified` tracks code changes, `Last Reviewed` tracks explicit human reviews.
