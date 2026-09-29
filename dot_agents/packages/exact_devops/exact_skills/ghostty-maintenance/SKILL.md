---
name: ghostty-maintenance
description:
  Robustly manage and build Ghostty from source on Linux. This skill handles
  environment recovery, dependency management, and version switching for the
  Ghostty terminal.
---

# Ghostty Maintenance

Use this skill to maintain, update, or recover a source-built Ghostty terminal
emulator.

## Environment Details

- **Source Directory:** `~/Downloads/ghostty`
- **Required Zig Version:** `0.15.2` (Check `build.zig.zon` for updates)
- **Zig Toolchain Path:** `~/Downloads/zig-x86_64-linux-0.15.2/zig`
- **Installation Prefix:** `~/.local`

## Robust Maintenance Workflows

### 1. Version Switching & Building

Always use the following steps to update or switch versions:

1. **Navigate to source:** `cd ~/Downloads/ghostty`
2. **Fetch latest:** `git fetch --tags`
3. **Checkout target:** `git checkout <tag_or_branch>` (e.g., `v1.3.1` or
    `main`).
4. **Rebuild:**

    ```bash
    ~/Downloads/zig-x86_64-linux-0.15.2/zig build -Doptimize=ReleaseFast --prefix ~/.local
    ```

### 2. Environment Recovery (If files are missing)

If `~/Downloads/ghostty` or Zig is missing:

1. **Re-clone Ghostty:**

    ```bash
    git clone https://github.com/ghostty-org/ghostty ~/Downloads/ghostty
    ```

2. **Re-download Zig 0.15.2:** Download from
    `https://ziglang.org/download/0.15.2/zig-linux-x86_64-0.15.2.tar.xz` and
    extract to `~/Downloads/`.
3. **Install Dependencies (Linux):** Ensure the following packages are
    installed (via `apt`): `libgtk-4-dev`, `libadwaita-1-dev`,
    `libfontconfig-dev`, `libfreetype-dev`, `libbz2-dev`, `libpng-dev`,
    `libharfbuzz-dev`, `libpixman-1-dev`, `blueprint-compiler`.

### 3. Terminfo Sync

If the terminal isn't recognized on remote SSH hosts:

```bash
cp -ri ~/Downloads/ghostty/zig-out/share/terminfo/* ~/.terminfo/
```

## Maintenance Notes

- **Minimum Zig version:** Always check `build.zig.zon` before building.
- **Optimization:** Use `-Doptimize=ReleaseFast` for production builds; omit it
  for debug builds.
- **Troubleshooting:** If the build fails, check if all `dev` libraries (GTK4,
  Adwaita) are installed.
