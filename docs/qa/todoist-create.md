# Todoist creation: discretionary QA and targeted deployment

Do not put these commands in CI or hooks. No unattended task creation. Run offline checks first:

```sh
bun test tests/todoist-create.test.ts tests/todoist-client.test.ts \
  tests/television-todoist.test.ts tests/television-actions.test.ts
bash docs/qa/todoist-create.sh
chezmoi diff ~/.config/todoist ~/.local/bin/todoist-add \
  ~/.config/television/cable/todoist.toml
```

After final source review, preview the installer **separately** (inspect rendered
policy decisions and command, do not execute yet):

```sh
chezmoi execute-template -f run_onchange_after_install-todoist-dependencies.sh.tmpl
chezmoi apply --dry-run --verbose --source-path run_onchange_after_install-todoist-dependencies.sh.tmpl
```

On the intended machine only, after reviewing the targeted diff and installer
preview, apply the exact app files, launcher, cable, then installer. The app is
installed under `~/.config/todoist` by chezmoi, even if the launcher uses
`XDG_CONFIG_HOME` to locate it at runtime. If XDG_CONFIG_HOME differs, arrange
for the app there before launching. Do not use broad `chezmoi apply`, which
could run unrelated package cleanup.

```sh
chezmoi apply --source-path \
  dot_config/todoist/package.json dot_config/todoist/bun.lock \
  dot_config/todoist/model.ts dot_config/todoist/client.ts \
  dot_config/todoist/ui.ts dot_config/todoist/create.ts \
  dot_local/bin/executable_todoist-add \
  dot_config/television/cable/todoist.toml
chezmoi apply --source-path run_onchange_after_install-todoist-dependencies.sh.tmpl
chezmoi diff ~/.config/todoist ~/.local/bin/todoist-add \
  ~/.config/television/cable/todoist.toml
```

If policy denies `@opentui/core`, `@doist/todoist-cli`, or Bun, the installer
skips the app dependencies; do not override policy to work around the skip.
The launcher requires Bun >=1.3.0 and td, and never downloads dependencies.
If desired, after installation check the native module without starting a
renderer: `bun --cwd ~/.config/todoist -e 'await import("@opentui/core")'`.
This is discretionary QA, not a unit test.

## Human-driven terminal and live checklist

- Run `todoist-add` in a real terminal. Check 80x24 layout and resize, title
  initial focus, Tab / Shift+Tab focus transitions, multiline description,
  filtered project and dependent section selection, section reset on project
  changes, No date and all literal date presets, and Custom input visibility.
- Cancel with Esc / Ctrl+C before submission: no task created and terminal
  restored. Exercise failed reads and retry, and a pending submit guard. For
  ambiguous create failure, check Todoist before retrying; no automatic retry.
- With deliberate operator participation and a disposable task only, submit
  once with Ctrl+S. Check the printed ID, terminal restoration, and all five
  fields in Todoist. Do not script UI interaction or create real tasks just
  for automated validation.
- In `tv todoist`, Ctrl+A overrides the default input-start shortcut and
  launches the same form. Confirm Television returns and refreshes its source.
  When a search hides all rows, clear it with Ctrl+U to obtain a selectable
  row before Ctrl+A (Television requires one). Verify Ctrl+D and Ctrl+Z still
  complete/undo as before.
