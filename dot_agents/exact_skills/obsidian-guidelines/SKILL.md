---
name: obsidian-guidelines
description: >
  Enforces writing conventions for the Obsidian notes app based on the kepano
  (Steph Ango) bottom-up methodology. Use when reading, writing, editing,
  searching, listing, or operating on any Obsidian vault file, or when the user
  mentions Obsidian, Second Brain, vault, notes, note-taking, journal,
  references, clippings, daily notes, evergreen notes, categories, tags,
  backlinks, or templates. Covers sync rules, folder structure, naming
  conventions, linking practices, note templates, and violation flagging.
---

# Obsidian Guidelines

## Vault Path

The vault path is should be documented in memory or context file. If not, ask
the user to clarify the vault path.

## Core Principles

- **File over app**: Plain Markdown files in standard formats you control
- **Bottom-up organization**: Structure emerges from links and categories, not
  folders
- **Avoid folders for categorization**: Use `categories:` property (Obsidian
  Bases) and internal links
- **No nested sub-folders**: Except the documented folder structure below

## Sync Rules

Auto-detect sync method based on vault directory contents and availability of
either headless Obsidian CLI (`ob`), Obsidian CLI (`obsidian`), or
version-control (`git`). If none of these options exist, flag this to the user.

### Obsidian CLI Sync (no `.git/` directory)

Before reading:

```bash
ob sync --path <vault_path>
```

After writing:

```bash
ob sync --path <vault_path>
```

### Git Backup (`.git/` directory exists)

Before reading:

```bash
cd <vault_path> && git pull
```

After writing:

```bash
cd <vault_path> && git add -A && git commit -m "vault update via Mochi" && git push
```

### Batch Operations

For both methods: sync once at start, perform all reads/writes, sync once at end
(if any writes occurred).

If sync fails, report the error clearly and stop. Do not proceed.

## Folder Structure

| Folder         | Purpose                                                            |
| -------------- | ------------------------------------------------------------------ |
| `Root`         | Personal notes, essays, evergreen notes, journal entries           |
| `References/`  | External things: Books, Movies, People, Places, Podcasts           |
| `Clippings/`   | Saved articles and essays by others                                |
| `Daily/`       | Empty daily notes named `YYYY-MM-DD.md`                            |
| `Attachments/` | Images, audio, videos, PDFs                                        |
| `Templates/`   | Reusable templates                                                 |
| `Archives/`    | Optional legacy imports from other note-taking systems (exception) |

See [references/vault-structure.md](references/vault-structure.md) for full
details.

## Naming Conventions

- **Dates**: Use `YYYY-MM-DD` everywhere (daily notes, journal entries, dated
  references)
- **Categories & tags**: Always pluralize (`Books`, `Movies`, not `Book`,
  `Movie`)
- **Reference notes**: Named by title (`Book Title.md`, `Movie Title.md`)
- **Daily notes**: `YYYY-MM-DD.md` in `Daily/`
- **Avoid non-standard Markdown**

See [references/naming-conventions.md](references/naming-conventions.md) for
full details.

## Note Types

| Type            | Location      | Purpose                                    |
| --------------- | ------------- | ------------------------------------------ |
| Daily notes     | `Daily/`      | Empty linking targets only                 |
| Journal entries | Root          | Stream of consciousness with profuse links |
| Evergreen notes | Root          | Atomic ideas, permanently useful           |
| Reference notes | `References/` | Books, movies, people, places, podcasts    |
| Clippings       | `Clippings/`  | Web-saved content by others                |
| Archives        | `Archives/`   | Legacy imported notes                      |

See [references/note-types.md](references/note-types.md) for full details.

## Linking Rules

- Use internal links profusely
- Always link the first mention of a concept, person, or thing in a note
- Navigate via quick switcher, backlinks, and links — not file explorer

See [references/linking.md](references/linking.md) for full details.

## Violation Flagging

When operating on the vault, flag deviations from these conventions:

- Creating a nested sub-folder (outside the defined structure)
- Using singular category/tag names
- Writing prose directly into a daily note
- Creating a reference note without using the title as filename
- Using non-standard Markdown syntax
- Failing to sync before read or after write

Flag the violation, explain the correct convention, and suggest the fix — but
allow the user to override if they have a specific reason.
