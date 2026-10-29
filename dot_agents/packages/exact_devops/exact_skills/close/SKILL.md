---
name: close
description:
  Closes the multiplexer pane the agent is running in. Use when asked to close
  your pane, tab, or terminal.
---

Close the multiplexer pane you are running in. Closing it ends your session, so
finish any reporting first and make the close command your final tool call.

Resolve the pane from your own environment, never from UI focus:

- **Herdr:** When `HERDR_ENV=1`, run `herdr pane close "$HERDR_PANE_ID"`. This
  takes precedence when Herdr is nested in Rex; close only the Herdr pane.
- **Rex:** Otherwise, when `REX_SESSION` and `REX_BLOCK` are set, run
  `rex block close -s "$REX_SESSION" "$REX_BLOCK"`.
- **Neither:** Report that you are not in a supported multiplexer pane.

To close after removing your worktree, append the command to the removal in the
same Bash call; see the `clean-merge` skill.
