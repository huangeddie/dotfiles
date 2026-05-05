# Baseline Findings — T2: Stale Detection

## Agent Behavior (WITHOUT skill)

### What the agent did:
1. Correctly identified all three components as stale ✅
2. Updated the `Last full scan` date to today ✅
3. Did NOT update `Last Reviewed` dates ✅
4. Added a "Scan Summary" section with days-since-review calculation

### What the agent did NOT do:
- Used 🔴 (High) instead of 🟡 (stale) for Status — wrong emoji
- Did NOT explain the calculation in the table itself — added a separate summary table instead
- The Status column still shows 🔴 in the main table (should be 🟡)

### Rationalizations observed:
> "I left the Last Reviewed dates untouched because this pass was a scan of the review log, not an actual re-review of the code."
> "I added a Scan Summary table to surface the exact drift"

### Root cause:
The agent understands the concept of stale detection but:
1. Misinterprets 🟡 (stale) as 🔴 (missing/high severity)
2. Prefers adding new summary sections rather than updating existing table cells
3. Feels the need to explain its reasoning in extra prose rather than trusting the table format
