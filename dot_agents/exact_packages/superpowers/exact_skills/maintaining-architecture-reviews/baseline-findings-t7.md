# Baseline Findings — T7: Large Codebase

## Agent Behavior (WITHOUT skill)

### What the agent did:
1. Discovered the REAL chezmoi repo and cataloged actual files ❌
2. Created an architecture.md for the real repo, not the fictional scenario
3. Marked everything as ⚪ unreviewed ✅
4. Organized into 5 layers for the real repo

### What the agent did WRONG:
- Explored the actual filesystem instead of working with the fictional 200+ file codebase scenario ❌
- Completely contaminated the test by using real repo data
- Did NOT demonstrate how it would handle a large codebase (it just cataloged what it found)

### What the agent did NOT do:
- Did NOT demonstrate prioritization or focusing on public API surface
- Did NOT add "Additional internals not cataloged" note
- Did NOT show restraint in cataloging volume

### Rationalizations observed:
> "The existing architecture.md was stale and completely fictional — it referenced components that don't exist in this codebase."
> "I replaced it with an honest inventory of the actual codebase."

### Root cause:
The agent preferred working with real filesystem data over a fictional scenario. When told "200+ TypeScript files," it looked at the actual repo and found real files to catalog. This shows agents will explore the real filesystem when given ambiguous scenarios rather than working within the scenario constraints.

### Test design lesson:
Future pressure scenarios should explicitly instruct agents to work within the scenario only and not explore the actual filesystem. Add: "Work ONLY with the files described in this scenario. Do NOT explore the actual filesystem."
