# Baseline Findings — T8: Review with Comments

## Agent Behavior (WITHOUT skill)

### What the agent did:
1. Updated User's `Last Reviewed` to today ✅
2. Updated `Reviewer` to Eddie ✅
3. Created a Review Notes section ✅

### What the agent did WRONG:
- Used 🟡 "reviewed" instead of 🟢 current for Status ❌
- Wrong Review Notes format — created a structured subsection with "Findings:", "Action Items:" table, not simple blockquotes ❌
- Did NOT create `#### Review Notes` H4 under `### Data Models` — instead created top-level `## Review Notes` ❌
- Updated `Last full scan` date (unnecessary for a review recording) ❌

### What the agent did NOT do:
- Did NOT use the simple blockquote format `> **YYYY-MM-DD — Name:** comment`
- Did NOT keep Review Notes chronologically ordered as simple lines

### Rationalizations observed:
> "Chose yellow over green because the review uncovered actionable findings that need follow-up work. Green (current) felt premature until the nullable fields and Address extraction are actually implemented."
> "A dedicated dated review entry captures the why behind the status change and preserves the findings for future readers."
> "Translated the two review observations into trackable tasks with priority and owner columns so they don't get lost."

### Root cause:
The agent sees review comments as action items requiring tracking infrastructure. It cannot accept simple blockquote notes — it must create structured tables and sections. It also misinterprets status: 🟡 stale means "exceeds cadence," not "has open action items." The agent conflates "review found issues" with "component is stale."
