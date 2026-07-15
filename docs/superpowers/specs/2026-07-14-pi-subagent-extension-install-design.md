# Pi Subagent Extension Installation Design

**Date:** 2026-07-14

## Goal

Install Pi's example `subagent` extension as reproducible chezmoi-managed configuration, select the requested OpenAI Codex models for its sample agents, and retire the custom `pi-subagent` Bash mechanism so the extension is the sole subagent interface.

## Managed files

The installation vendors the upstream example into chezmoi source state:

```text
dot_pi/agent/
├── exact_extensions/subagent/
│   ├── index.ts
│   └── agents.ts
├── agents/
│   ├── planner.md
│   ├── reviewer.md
│   ├── scout.md
│   └── worker.md
└── prompts/
    ├── implement-and-review.md
    ├── implement.md
    └── scout-and-plan.md
```

Vendoring is preferred over symlinking to the transient npm/npx installation path because the installed extension remains versioned, portable, and reproducible. The files remain attributable to their upstream example and can be refreshed explicitly from a later Pi checkout.

## Agent model contract

The sample frontmatter is changed as follows:

| Agent | Model |
| --- | --- |
| `scout` | `openai-codex/gpt-5.6-luna` |
| `planner` | `openai-codex/gpt-5.6-terra` |
| `reviewer` | `openai-codex/gpt-5.6-terra` |
| `worker` | `openai-codex/gpt-5.6-terra` |

Provider-qualified selectors avoid ambiguity and match Pi's live `--list-models` catalog.

## Runtime behavior

Chezmoi deploys the extension to `~/.pi/agent/extensions/subagent`, agents to `~/.pi/agent/agents`, and workflow templates to `~/.pi/agent/prompts`. Pi discovers the extension and templates at startup or `/reload`. The root model receives the registered `subagent` tool schema; the workflow templates provide explicit orchestration instructions.

## Retired Bash interface

Remove all active support owned specifically by the old wrapper. A root `.chezmoiremove` entry removes the two non-exact deployed targets on every managed machine instead of merely forgetting their source files.

- `dot_local/bin/executable_pi-subagent`
- its root-agent instruction in `dot_pi/agent/APPEND_SYSTEM.md`
- `tests/pi-subagent.test.ts`
- wrapper-only QA documents
- `pi-subagent` command detection, environment/report-file transport, child-report publication, runtime reattribution, and their tests in the runtime-status extension/core

Historical specs and plans remain as architectural history. The local untracked model-selection state file may remain because it is inert without the wrapper and is outside chezmoi ownership.

After removal, the root model learns delegation through Pi's registered `subagent` tool schema and the installed workflow templates, rather than a system-prompt instruction to invoke Bash.

## Verification

This is a configuration/vendor installation, so red-green TDD does not apply. Verification will:

1. Confirm both requested model selectors exist in `pi --list-models`.
2. Inspect the chezmoi diff before deployment.
3. Apply the managed source.
4. Confirm deployed files and model frontmatter match source state.
5. Confirm `.chezmoiremove` removes the deployed wrapper and appended system prompt.
6. Run deterministic runtime-status and full repository tests after removing wrapper telemetry.
7. Start Pi non-interactively with the extension and verify it loads without startup errors, without making a model request.

No network-backed QA model invocation is required.
