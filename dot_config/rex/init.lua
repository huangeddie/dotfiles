-- Rex config migrated from Herdr, Ghostty, kitty, Alacritty and iTerm2.

-- Herdr (~/.config/herdr/config.toml), prefix ctrl+space
rex.bind("ctrl+space>j", "pane.focus", { direction = "down" })
rex.bind("ctrl+space>h", "pane.focus", { direction = "left" })
rex.bind("ctrl+space>l", "pane.focus", { direction = "right" })
rex.bind("ctrl+space>k", "pane.focus", { direction = "up" })
rex.bind("ctrl+space>c", "client.tab.new")
rex.bind("ctrl+alt+n", "client.tab.new")
rex.bind("ctrl+alt+shift+n", "session.new")
rex.bind("ctrl+space>n", "client.tab.next")
rex.bind("ctrl+alt+l", "client.tab.next")
rex.bind("ctrl+alt+j", "session.next")
rex.bind("ctrl+space>p", "client.tab.previous")
rex.bind("ctrl+alt+h", "client.tab.previous")
rex.bind("ctrl+alt+k", "session.previous")
rex.bind("ctrl+space>-", "pane.split", { direction = "down" })
rex.bind("ctrl+space>v", "pane.split", { direction = "right" })
rex.bind("ctrl+alt+a", "client.sidebar.toggle")
rex.bind("ctrl+space>z", "pane.zoom")
-- Programs that use the prefix key themselves still receive it.
rex.bind("ctrl+space>ctrl+space", "pane.send_key", { key = "ctrl+space" })

-- Ghostty (~/.config/ghostty/config)
rex.bind("shift+insert", "pane.paste")
rex.bind("alt+cmd+h", "pane.focus", { direction = "left" })
rex.bind("alt+cmd+j", "pane.focus", { direction = "down" })
rex.bind("alt+cmd+k", "pane.focus", { direction = "up" })
rex.bind("alt+cmd+l", "pane.focus", { direction = "right" })

-- iTerm2 (Default profile Keyboard Map)
rex.bind("delete", "pane.send_key", { key = "ctrl+d" })
