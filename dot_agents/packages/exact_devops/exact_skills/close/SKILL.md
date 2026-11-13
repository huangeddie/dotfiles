---
name: close
description:
  Use when asked to close the agent's pane, tab, terminal, or multiplexer session.
---

Close your own pane or terminal using the `close` helper, which resolves your
inherited environment in priority order—never UI focus. It never closes sibling
panes, tabs, or the whole session:

1. **Rex (`REX_SESSION` + `REX_BLOCK`):** Closes only your `REX_BLOCK` pane; its
   tab closes when that was its last pane.
2. **Herdr App (`HC_TERMINAL_ID`):** Ends your `herdr-core` terminal via `hc`,
   closing its Herdr App pane and any child sub-agents.
3. **Herdr (`HERDR_ENV=1`):** Closes only your `HERDR_PANE_ID` pane.

Finish any reporting first, then run `close` as your final tool call:

```sh
close
```

If `close` exits nonzero (missing context or a failed command), report its error
instead of choosing another target or running UI focus commands such as
`herdr-app do pane.close`.

To close after removing your worktree, chain `close` after successful removal in
the same final Bash call (`... && close`); see the `clean-merge` skill.
