# Vault Structure

## Philosophy

The vault follows a bottom-up organization style inspired by kepano (Steph Ango).
Structure emerges from links and categories, not from folder hierarchies.

## Core Rules

1. **Avoid folders for categorization** — use `categories:` frontmatter property and internal links instead
2. **No nested sub-folders** — keep the folder structure flat
3. **Navigate via links and search** — not the file explorer

## Folder Layout

```
Root/
  Personal notes, essays, evergreen notes, journal entries
  These are things I wrote or relate directly to me

References/
  External things: Books, Movies, People, Places, Podcasts
  Always named using the title: "Book Title.md", "Movie Title.md"

Clippings/
  Things other people wrote
  Mostly essays and articles saved from the web

Daily/
  Empty daily notes: YYYY-MM-DD.md
  Exist solely to be linked to from other entries
  Never write prose here

Attachments/
  Images, audio, videos, PDFs, and other media

Templates/
  Reusable note templates

Archives/
  Legacy imports from other note-taking systems
  This is an exception to the no-folders rule
  Treat as read-only when possible; migrate active notes to proper locations
```

## Categories vs Folders

Use Obsidian Bases (`categories:` property in frontmatter) to view notes by category.
This is preferred over folders because many notes belong to multiple areas of thought.

Example frontmatter:
```yaml
---
categories:
  - Books
  - Essays
tags:
  - philosophy
---
```

## What Not To Do

- Do not create `Work/`, `Personal/`, `Projects/` type folders
- Do not create year-based folders like `2024/`, `2025/`
- Do not create deeply nested paths like `References/Books/Fiction/`
- Do not put daily notes anywhere except `Daily/`
