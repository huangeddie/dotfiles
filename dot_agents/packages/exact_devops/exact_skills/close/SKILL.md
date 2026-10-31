---
name: close
description:
  Use when asked to close the agent's pane, tab, terminal, or multiplexer session.
---

In Rex, close the entire session identified by `REX_SESSION`, including all its
windows and panes—not just the agent's window or pane. In Herdr, close only the
agent's pane; Herdr takes precedence when nested in Rex.

Finish any reporting first, then make these commands your final tool call:

```sh
if [ "${HERDR_ENV:-}" = 1 ]; then
  close
elif [ -n "${REX_SESSION:-}" ]; then
  rex --autostart=false --timeout 2s kill -- "$REX_SESSION"
else
  printf '%s\n' 'Not in a Rex session or Herdr pane; nothing closed.' >&2
  exit 1
fi
```

Use inherited context, never UI focus. If context is missing or the command
fails, report the error instead of selecting another target. The standalone
`close` helper closes only a pane, so use it only for the Herdr branch above.

To close after removing your worktree, run the closing commands above after
successful removal in the same Bash call.
