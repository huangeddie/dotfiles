---
name: close
description:
  Closes the multiplexer pane the agent is running in. Use when asked to close
  your pane, tab, or terminal.
---

Close the multiplexer pane you are running in. Closing it ends your session, so
finish any reporting first and make `close` your final tool call:

```sh
close
```

`close` resolves your pane from the inherited Rex or Herdr environment, never
from UI focus, and prefers Herdr when it is nested in Rex. If it reports that
you are not in a Rex or Herdr pane, relay that instead of closing anything.

To close after removing your worktree, append `close` to the removal in the
same Bash call; see the `clean-merge` skill.
