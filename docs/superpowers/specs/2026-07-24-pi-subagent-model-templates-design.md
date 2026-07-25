# Pi Subagent Model Templates Design

**Date:** 2026-07-24

## Purpose

Replace the duplicated GPT- and Claude-prefixed Pi subagent definitions with one backend-neutral definition for each role: `scout`, `planner`, `reviewer`, and `worker`.

Each role selects a stable, versioned model alias in chezmoi data. Chezmoi derives the backend, backend-native model identifier, and backend-native tool allowlist and renders those values into the agent's YAML front matter. Switching a role's model must not require editing its system-prompt body.

## Data contract

The configuration lives at:

```text
.chezmoidata/pi/subagents.yaml
```

Chezmoi recursively reads this file and merges its contents into the top-level `.subagents` template value. The `pi/` directory organizes source state; it does not introduce a `.pi` data namespace.

The initial schema is:

```yaml
subagents:
  assignments:
    scout: gpt-5.6-luna
    planner: gpt-5.6-terra
    reviewer: gpt-5.6-terra
    worker: gpt-5.6-terra

  models:
    gpt-5.6-luna:
      backend: pi
      model: openai-codex/gpt-5.6-luna
    gpt-5.6-terra:
      backend: pi
      model: openai-codex/gpt-5.6-terra
    claude-haiku-5:
      backend: claude
      model: haiku
    claude-sonnet-5:
      backend: claude
      model: sonnet

  tools:
    scout:
      pi: read, grep, find, ls, bash
      claude: Read, Grep, Glob, Bash, WebSearch, WebFetch
    planner:
      pi: read, grep, find, ls
      claude: Read, Grep, Glob, WebSearch, WebFetch
    reviewer:
      pi: read, grep, find, ls, bash
      claude: Read, Grep, Glob, Bash, WebSearch, WebFetch
    worker:
      pi: null
      claude: Read, Write, Edit, Glob, Grep, Bash, WebSearch, WebFetch
```

### Assignments

`assignments` is the only routinely edited section. Every supported role has exactly one stable model alias. Roles select models independently, so mixed-backend workflows remain supported.

### Model catalog

`models` maps stable, user-facing aliases to invocation metadata. The backend is explicit; templates must not infer it from an alias prefix.

The catalog is an invocation-routing catalog, not a replacement for Pi's live provider/model registry. A Pi-backed entry stores Pi's provider-qualified selector. A Claude-backed entry stores the Claude CLI model selector. Versioned aliases make model-generation changes explicit even when a backend offers an unversioned CLI selector such as `sonnet`.

### Tool policies

`tools` is keyed by role and backend because permissions depend on both responsibilities and backend-native tool names. A string is rendered as the front matter's comma-separated `tools` value. `null` means omit `tools` and use that backend's defaults. The subagent extension continues to exclude nested `subagent` execution from Pi children, and Claude definitions continue to reject the nested `Agent` tool.

## Agent definition contract

Chezmoi deploys exactly these files:

```text
~/.pi/agent/agents/planner.md
~/.pi/agent/agents/reviewer.md
~/.pi/agent/agents/scout.md
~/.pi/agent/agents/worker.md
```

Each rendered file has this interface:

```yaml
---
name: <role>
description: <backend-neutral role description>
backend: <resolved backend>
model: <resolved backend-native model identifier>
tools: <resolved role/backend tools, omitted when null>
---
```

The Markdown body is backend-neutral and owned by the role. Model selection affects only rendered front matter. The old `gpt-*` and `claude-*` agent names are removed without compatibility aliases.

## Rendering architecture

A shared template owns front-matter resolution and validation:

```text
.chezmoidata/pi/subagents.yaml
             │
             ▼
.chezmoitemplates/pi-subagent-frontmatter.tmpl
             │
             ├── dot_pi/agent/exact_agents/scout.md.tmpl
             ├── dot_pi/agent/exact_agents/planner.md.tmpl
             ├── dot_pi/agent/exact_agents/reviewer.md.tmpl
             └── dot_pi/agent/exact_agents/worker.md.tmpl
```

Each role template invokes the shared front-matter template with its role and backend-neutral description, then contains its canonical system-prompt body unchanged by model selection.

For a role, rendering performs these deterministic steps:

1. Read `.subagents.assignments[role]`.
2. Resolve that alias through `.subagents.models`.
3. Validate the resolved `backend` and backend-native `model`.
4. Resolve `.subagents.tools[role][backend]`.
5. Render the role name, description, backend, model, and optional tools.
6. Append the role's backend-neutral body.

The existing extension remains the runtime composition root. It discovers the rendered definitions on every subagent invocation, parses the front matter, and routes through the selected backend adapter. No extension implementation change is required.

## Workflow migration

The managed prompt templates change to generic role names:

- `/implement`: `scout` → `planner` → `worker`
- `/scout-and-plan`: `scout` → `planner`
- `/implement-and-review`: `worker` → `reviewer` → `worker`

Because names no longer encode routing, changing an assignment automatically changes the backend used by every workflow that references that role.

## Error behavior

Template rendering fails before deployment with an actionable diagnostic when:

- a required role has no assignment;
- an assignment references an unknown alias;
- a model entry omits `backend` or `model`;
- a model entry names a backend other than `pi` or `claude`;
- a role has no tool-policy mapping for the resolved backend; or
- a non-null tool policy is blank.

There is no fallback to another model or backend. Runtime validation in `parseAgentDefinition` remains a second boundary against malformed rendered definitions.

## Verification

The change is primarily managed configuration, so it does not introduce a production logic abstraction solely to test chezmoi's renderer. Existing deterministic Bun tests remain responsible for agent-definition parsing, backend routing, invocation construction, stream normalization, orchestration, and process handling.

Verification consists of:

1. Render all four source templates with chezmoi.
2. Confirm the rendered definitions satisfy `parseAgentDefinition`.
3. Run the complete Bun unit suite.
4. Inspect `chezmoi diff` before applying.
5. Apply the managed agents and prompts.
6. Confirm exactly the four generic agent files are deployed.
7. Reload Pi so updated prompt templates are available.
8. Update and manually run the relevant backend QA procedure when production credentials are available.

The manual QA remains excluded from hooks and CI because it invokes production model CLIs.

## Non-goals

- Runtime backend or model overrides in the `subagent` tool call.
- Inferring a backend from model alias naming.
- Discovering aliases dynamically from Pi or Claude catalogs.
- Preserving backend-prefixed compatibility aliases.
- Changing backend adapters, stream parsers, orchestration, or process execution.
- Sharing one system-prompt body across different roles.
