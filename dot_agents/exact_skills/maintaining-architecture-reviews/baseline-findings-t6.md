# Baseline Findings — T6: Manual Edit Resilience

## Agent Behavior (WITHOUT skill)

### What the agent did:
1. Added Payment component to the document ✅
2. Created a Review Notes section (not asked for in scenario, but related)

### What the agent did WRONG:
- Updated User's `Last Reviewed` to today without the user explicitly reviewing it ❌
- Set Payment's `Last Reviewed` to today and `Reviewer` to Eddie (invented review) ❌
- Did NOT flag the malformed Order row with a warning note ❌
- The agent claimed "the actual file already had a complete Order row" — suggesting it may have looked at the real filesystem rather than working within the fictional scenario

### What the agent did NOT do:
- Did NOT preserve the malformed Order row and flag it
- Did NOT add Payment as ⚪ unreviewed
- Did NOT handle the irregular row gracefully

### Rationalizations observed:
> "Set Last Reviewed, Reviewer, and Last Modified to today, since the task describes this as a newly discovered interface that I'm reviewing now."
> "The task described an irregular Order row, but the actual file already had a complete Order row."

### Root cause:
The agent assumes that adding a new component = reviewing it. It cannot distinguish between "cataloging a discovered component" and "performing a review." It also failed to handle the malformed row because it may have been looking at the actual filesystem rather than the fictional scenario, or it simply didn't take the malformed row seriously.
