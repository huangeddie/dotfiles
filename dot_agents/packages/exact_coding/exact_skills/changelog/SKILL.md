---
name: changelog
description:
  Write the next CHANGELOG.md entry for end users. Use when asked to update the
  changelog, write release notes.
---

# Changelog Skill

Curate the commits since the last release into a short, user-facing entry at the
top of `CHANGELOG.md`, and commit it.

**Audience:** End users, not developers. Write in product language about what a
user can now do or will notice. Never mention files, classes, commands, schemas,
refactors, tests, CI, or dependency bumps.

## Choose the semantic versioning bump

You decide.

- `minor` — any user-visible `feat`.
- `patch` — only fixes or user-visible polish.
- Never choose `major` on your own; 1.0 is a product milestone. Ask the user.
- If nothing user-facing changed, do not release. Tell the user instead.

The new version is the previous tag's `X.Y.Z` with the bump applied, written
`vX.Y.Z` (e.g. `v1.0.0` + `minor` → `v1.1.0`). Tags before `v1.0.0` carried an
`-alpha` label.

## Write the entry

Insert below the file's intro, above the previous entry, in
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) form:

```markdown
## [v1.1.0] - 2026-10-28

### Added

- Tap any word in an exchange to see its meaning and vocabulary level.

### Fixed

- Recordings no longer stop transcribing after a long pause.
```

- Sections, in order, only when non-empty: `Added`, `Changed`, `Fixed`,
  `Removed`.
- One bullet per user-visible outcome. Merge related commits; drop internal ones
  (`chore`, `refactor`, `test`, `ci`, `build`, `docs`, merges).
- Use the product's vocabulary (Clippings, Recordings, Situations, Focus,
  Prepare, Flashcards, Read Aloud, Exchanges) as defined in `CLAUDE.md`.
- Name the client when a change is platform-specific ("On iOS, ...").
- Date is today's date (ISO 8601).
