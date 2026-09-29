---
name: gnome-chrome-app-shortcuts
description: >-
  Creates GNOME custom keyboard shortcuts for dedicated Google Chrome apps (like
  Gmail, Calendar, Chat). 
  Use when the user asks to map Chrome apps to keyboard shortcuts on
  Debian/Ubuntu/GNOME, or when setting up a fresh machine. Don't use for
  non-Chrome applications or non-GNOME desktop environments.
---

# GNOME Chrome App Shortcuts

This skill guides you through automating the creation of custom keyboard
shortcuts in GNOME for dedicated Google Chrome apps (PWAs).

## Prerequisites

Before applying any shortcuts, ALWAYS confirm with the user that they have
installed the necessary web apps as dedicated Google Chrome apps. You can verify
their existence by checking:

```bash
ls -la ~/.local/share/applications/chrome-*.desktop
```

## Finding Chrome App Commands

Chrome apps are saved as `.desktop` files. To find the correct `Exec=` command
and App ID for a specific app (e.g., Gmail, Calendar, Chat):

```bash
cat ~/.local/share/applications/chrome-* | grep -E "Name=|Exec="
```

Copy the full `Exec=` value (e.g.
`/opt/google/chrome/google-chrome --profile-directory=Default --app-id=kjbdgfilnfhdoflbpgamdcdgpehopbep`)
for the command step below.

## Adding Custom Keybindings in GNOME

GNOME stores custom keybindings in dconf. To add new ones via CLI, use
`gsettings`.

### 1. Identify Existing Shortcuts

First, get the list of existing custom keybindings:

```bash
gsettings get org.gnome.settings-daemon.plugins.media-keys custom-keybindings
```

Example output:
`['/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/']`

### 2. Append New Shortcuts to the List

Determine the next available custom IDs (e.g., `custom1`, `custom2`). You must
overwrite the list to include the old + new paths:

```bash
gsettings set org.gnome.settings-daemon.plugins.media-keys custom-keybindings "['/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/', '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom1/']"
```

### 3. Configure the New Shortcut

For each new custom ID, set its `name`, `command`, and `binding`:

```bash
gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom1/ name 'Google Calendar'

gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom1/ command '<The Exec command from earlier>'

gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom1/ binding '<Super>c'
```

### 4. Verify

Check that the new bindings were saved correctly by dumping the dconf path:

```bash
dconf dump /org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/
```

