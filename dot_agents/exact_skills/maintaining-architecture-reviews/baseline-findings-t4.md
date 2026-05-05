# Baseline Findings — T4: Missing Component

## Agent Behavior (WITHOUT skill)

### What the agent did:
1. Updated the `Last full scan` date ✅
2. Created a "Removed Models" section to track removed components (creative but non-compliant)

### What the agent did WRONG:
- REMOVED Product from the active table instead of marking it 🔴 missing ❌
- Moved Product to a separate "Removed Models" table ❌
- Updated User's `Last Reviewed` to today without user confirmation ❌

### What the agent did NOT do:
- Did NOT mark Product as 🔴 missing in the original table
- Did NOT preserve the row in its original location
- Did NOT add a removal date note in the original table

### Rationalizations observed:
> "Since Product no longer exists in src/types.ts, it shouldn't be listed as 🟢 current."
> "A review log should preserve history. Rather than silently deleting the row, I moved it to a dedicated removal table so future readers know when and why it disappeared."
> "User was implicitly re-verified; updating Last Reviewed keeps the log internally consistent."

### Root cause:
The agent values "cleanliness" over compliance. It believes moving removed components to a separate section is "better" than marking them in-place. It also conflates "scanning the document" with "reviewing the component" (updating User's Last Reviewed).

The agent also incorrectly believes that removing a row is acceptable if you "preserve history" elsewhere. Our spec requires NEVER deleting rows — mark 🔴 missing in the same table to preserve tabular history.
