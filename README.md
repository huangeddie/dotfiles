# dotfiles

Personal dotfiles managed with [chezmoi](https://www.chezmoi.io/). Reference the
chezmoi skill for more info.

## Agent Harness Config

There're many terminal agent harnesses e.g. Gemini CLI, Codex CLI, Claude Code,
Pi. _We aim to decouple as much of our agent configuration from specific harness
implemenations as much as possible_.

As such, we make it an effort to put most of our agent configs including skills,
prompts, and context files under @dot_agents/.

Directory structure:

```text
dot_agents/
├── AGENTS.md                    # Shared agent instructions; applies to ~/.agents/AGENTS.md.
├── exact_plugins/               # Shared plugin marketplace; applies to ~/.agents/plugins/.
│   └── marketplace.json         # Codex marketplace catalog.
└── exact_packages/              # Shared package registry; applies to ~/.agents/packages/.
    └── <package>/
        ├── exact_skills/        # Shared skills; applies to skills/.
        ├── dot_claude-plugin/   # Claude Code manifest; applies to .claude-plugin/.
        ├── dot_codex-plugin/    # Codex CLI manifest; applies to .codex-plugin/.
        ├── gemini-extension.json
        └── package.json         # Pi package manifest.
```

Agent harnesses with configs that don't quite align with our configuration can
refer to those configs by either pointing to the resulting target path
(~/.agents/) or by symlink.

Note that we have agent-provider specific manifests like `dot_claude-plugin`
within our config. This is ok because it doesn't compromise the content of our
agnostic configs.
