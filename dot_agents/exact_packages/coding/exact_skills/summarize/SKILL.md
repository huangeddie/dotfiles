---
name: summarize
description: "Summarize the work done and copy it to clipboard."
---

# Summarize

Write a clipboard-ready self-contained summary of the work we've done,
defaulting to everything unless otherwise specified.

## Workflow

1. Reflect on the work done, focusing on user specification if any. If the user
   gives only a short label, infer from the current repo, recent discussion,
   branch name, linked issue/PR, docs, and obvious nearby context.
2. Gather enough context to write a useful self-contained summary of the work.
3. Copy the full summary to the clipboard.
4. Final reply: terse confirmation of the summary. Do not paste the full prompt
   unless the user asks.

## Clipboard

On macOS:

```sh
pbcopy < /tmp/handoff-prompt.txt
```

Use a temp file or pipe. Avoid inline shell quoting for prompts containing
backticks, `$`, quotes, or user text.

If `pbcopy` is unavailable, use the obvious platform clipboard tool (`wl-copy`,
`xclip`, `clip.exe`) or print the prompt and say clipboard copy was unavailable.
