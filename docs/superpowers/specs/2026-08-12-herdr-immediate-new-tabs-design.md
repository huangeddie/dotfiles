# Herdr Immediate New Tabs Design

## Goal

Create new Herdr tabs immediately with Herdr-generated names instead of opening the tab-name prompt.

## Design

Set `ui.prompt_new_tab_name` to `false` in the chezmoi-managed Herdr configuration. This uses Herdr's documented configuration contract and applies consistently to every built-in `new_tab` binding, including `prefix+c` and `ctrl+alt+n`.

A custom command invoking `herdr tab create` is unnecessary and would duplicate Herdr's built-in new-tab action.

## Verification

Validate the source configuration with `herdr config check`, inspect `chezmoi diff`, apply the source state, and confirm the deployed configuration contains the setting.
