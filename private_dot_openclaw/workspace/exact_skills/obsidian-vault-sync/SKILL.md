---
name: obsidian-vault-sync
description: Enforces Obsidian Sync pull-before-read and push-after-write for the vault at ~/Documents/Second Brain/. Use when reading, writing, editing, searching, listing, or operating on any file under ~/Documents/Second Brain/ or /home/eddie/Documents/Second Brain/, or when the user mentions Obsidian, Second Brain, vault, notes, or any note-taking operation.
---

# Obsidian Vault Sync

## Vault

- **Path:** `~/Documents/Second Brain/`
- **Sync command:** `ob sync --path ~/Documents/Second\ Brain`
- **Tool:** `obsidian-cli` (available as `ob`)
- **Mode:** bidirectional, merge conflicts
- **Typical duration:** ~1 second

## Rules

### Before Reading

Always run sync before reading any vault file(s):

```bash
ob sync --path ~/Documents/Second\ Brain
```

Then use `read`, `exec` (grep/find), or other tools to access vault content.

### After Writing

Always run sync after writing or editing any vault file(s):

```bash
ob sync --path ~/Documents/Second\ Brain
```

Never skip this step after writes.

### Batch Operations

When reading or writing multiple files in a single task:
1. Run sync once at the start
2. Perform all reads and/or writes
3. Run sync once at the end (if any writes occurred)

## Error Handling

If `ob sync` fails:
1. Report the error clearly
2. Do not proceed with the vault operation
3. Common causes: network issues, Obsidian Sync subscription, vault not configured

## Rationale

The vault is synced across multiple devices. Explicit sync prevents stale reads and conflicts with edits made on other devices.
