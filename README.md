# dotfiles

Personal dotfiles managed with [chezmoi](https://www.chezmoi.io/). Reference the
chezmoi skill for more info.

## Agent files

There're many terminal agent harnesses e.g. Gemini CLI, Codex CLI, Claude Code,
Pi. We want to decouple as much of our agent configuration from specific harness
implemenations as much as possible. As such, we make it an effort to put most of
our agent configs including skills, prompts, and context files under
@dot_agents/ . Configs for specific agent harness can refer to those configs by
either pointing to the resulting target path (~/.agents/) or by symlink.
