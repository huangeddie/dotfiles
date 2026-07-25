# Pi Subagent Runtime Profiles Design

## Summary

Pi subagents will switch between GPT and Claude as a single global runtime
profile. The selected profile will live in XDG state and a shell CLI will change
it atomically. The subagent extension will resolve the selected profile at the
start of every tool invocation, so switching profiles will not rewrite managed
agent files and will not require `chezmoi apply` or `/reload`.

Chezmoi remains responsible for static configuration and prompts. Runtime state
remains outside chezmoi source state.

## Goals

- Switch all four generic roles between GPT and Claude with
  `pi-subagents use gpt|claude`.
- Make a profile change effective on the next subagent tool invocation without
  applying chezmoi or reloading Pi.
- Keep model aliases, backend-native model identifiers, and role/backend tool
  policies explicit and validated.
- Keep role prompts backend-neutral.
- Preserve direct front-matter routing for custom and project-local agents.
- Isolate filesystem effects behind narrow interfaces and test domain logic
  deterministically with fakes.

## Non-goals

- Per-role profile selection.
- Runtime backend or model overrides in subagent tool calls.
- Automatic production-model QA.
- A Pi-only slash command for profile selection.
- Compatibility aliases for the removed backend-prefixed agent definitions.

## Data contracts

### Managed profile catalog

Chezmoi will manage this source and target:

- Source: `dot_pi/agent/subagent-profiles.json`
- Target: `~/.pi/agent/subagent-profiles.json`

The initial catalog is:

```json
{
  "version": 1,
  "defaultProfile": "gpt",
  "profiles": {
    "gpt": {
      "scout": "gpt-5.6-luna",
      "planner": "gpt-5.6-terra",
      "reviewer": "gpt-5.6-terra",
      "worker": "gpt-5.6-terra"
    },
    "claude": {
      "scout": "claude-haiku-5",
      "planner": "claude-sonnet-5",
      "reviewer": "claude-sonnet-5",
      "worker": "claude-sonnet-5"
    }
  },
  "models": {
    "gpt-5.6-luna": {
      "backend": "pi",
      "model": "openai-codex/gpt-5.6-luna"
    },
    "gpt-5.6-terra": {
      "backend": "pi",
      "model": "openai-codex/gpt-5.6-terra"
    },
    "claude-haiku-5": {
      "backend": "claude",
      "model": "haiku"
    },
    "claude-sonnet-5": {
      "backend": "claude",
      "model": "sonnet"
    }
  },
  "tools": {
    "scout": {
      "pi": ["read", "grep", "find", "ls", "bash"],
      "claude": ["Read", "Grep", "Glob", "Bash", "WebSearch", "WebFetch"]
    },
    "planner": {
      "pi": ["read", "grep", "find", "ls"],
      "claude": ["Read", "Grep", "Glob", "WebSearch", "WebFetch"]
    },
    "reviewer": {
      "pi": ["read", "grep", "find", "ls", "bash"],
      "claude": ["Read", "Grep", "Glob", "Bash", "WebSearch", "WebFetch"]
    },
    "worker": {
      "pi": null,
      "claude": ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "WebSearch", "WebFetch"]
    }
  }
}
```

The schema is normalized around stable model aliases:

- A profile maps each configured role to one model alias.
- A model alias maps once to a backend and backend-native model identifier.
- A role/backend pair maps once to a tools array or, for Pi only, `null`.

Catalog version `1` supports only `pi` and `claude` backends. Every profile must
contain the same non-empty role set, every alias reference must exist, and every
configured role must have a policy for the resolved backend. Claude requires a
non-empty tools array. Pi accepts a non-empty tools array or `null`; `null`
means the Pi backend uses its default unrestricted child-process tools. Claude
tool policies must not include the nested `Agent` tool, preserving the existing
no-recursive-subagent contract.

### Runtime selection

The active profile is stored at:

```text
${XDG_STATE_HOME:-$HOME/.local/state}/pi/subagents-profile
```

The file contains exactly one profile name and an optional final newline, for
example `claude\n`. Profile names are non-empty strings containing only ASCII
letters, digits, `.`, `_`, and `-`. A missing file selects `defaultProfile`. An
empty, unreadable, malformed, or unknown selection is an error rather than an
implicit fallback.

The state file is runtime data and is not managed by chezmoi.

## Agent front matter

The four generic user agents become plain Markdown files rather than chezmoi
templates. Their front matter contains only identity metadata:

```yaml
---
name: scout
description: Fast codebase reconnaissance that returns compressed context for handoff
---
```

The prompt bodies remain unchanged and backend-neutral. `backend`, `model`, and
`tools` are no longer rendered into these four files. Consequently, the old
`.chezmoidata/pi/subagents.yaml` assignments and
`.chezmoitemplates/pi-subagent-frontmatter.tmpl` are removed.

Direct agent definitions outside the configured user roles retain their current
front-matter behavior, including the existing omitted-backend default.

## Runtime architecture

### Pure profile domain

A dependency-light module under the subagent extension owns:

- Catalog and resolved-profile types.
- Strict catalog and selection parsing, rejecting unknown object properties.
- Catalog-wide referential validation.
- Pure role resolution from profile, alias, model, and tool policy.
- Actionable diagnostics that identify the invalid JSON path.

It does not import Pi SDK APIs, spawn processes, or access the filesystem. This
allows the CLI and extension to share one parser and resolver.

### Effect boundaries

Filesystem access is isolated behind consumer-owned interfaces equivalent to:

```ts
interface ProfileCatalogRepository {
  load(): Promise<ProfileCatalog>;
}

interface ProfileSelectionStore {
  read(): Promise<string | undefined>;
  write(profile: string): Promise<void>;
}
```

Production adapters read the managed catalog and XDG state path. Unit tests use
in-memory fakes. Concrete adapters are wired at the extension and CLI
composition roots.

### Invocation flow

At the beginning of each `subagent` tool invocation, before any backend starts:

1. Discover agents using the existing scope rules.
2. Load and validate the catalog and selection once.
3. Resolve one immutable active-profile snapshot.
4. Overlay effective backend, model, and tools onto discovered agents only when
   the agent is from user scope and its name is configured in the profile.
5. Pass the effective definitions to the existing orchestrator.

One invocation therefore uses one profile snapshot across single, parallel, and
chain modes. A concurrent CLI switch affects only later invocations.

A project-local definition that shadows a configured user role keeps its own
front matter because profile routing never overlays project-scope agents.
Unconfigured user agents also keep their existing direct front-matter routing.

Catalog or selection failure stops the entire tool invocation before any
backend starts. This prevents mixed-profile partial execution.

## CLI contract

Chezmoi manages `dot_local/bin/executable_pi-subagents`, deployed as
`~/.local/bin/pi-subagents`.

```text
pi-subagents                 # active profile and resolved role assignments
pi-subagents list            # available profiles
pi-subagents use gpt         # atomically select GPT
pi-subagents use claude      # atomically select Claude
```

The CLI uses the same deployed parser/resolver module as the extension.

`use` performs these steps:

1. Parse and validate the complete catalog.
2. Verify exactly one requested profile argument and ensure it exists.
3. Create the state directory when absent.
4. Write the new value to a same-directory temporary file with private
   permissions.
5. Atomically rename the temporary file over the state file.
6. Report the selected profile and resolved role assignments.

An invalid command, catalog, or profile exits nonzero without changing existing
state. Re-selecting the active profile is idempotent. The CLI does not invoke
chezmoi or Pi.

The implementation uses the existing Bun runtime. The shared profile module
must remain independent of globally installed Pi package imports so the CLI can
load it directly from the deployed extension directory.

## Error handling

Diagnostics must identify the failing source and path, including:

- Unsupported catalog version.
- Missing or wrong-typed top-level mappings.
- Empty or inconsistent profile role sets.
- Unknown alias references.
- Invalid backend or backend-native model identifier.
- Missing or invalid role/backend tool policies.
- Empty, whitespace-only, non-string, or duplicate tool names.
- Invalid Claude `null` or empty tools, including the forbidden nested `Agent`
  tool.
- Empty, malformed, unreadable, or unknown selected profile.

State writes use a temporary file and atomic rename, ensuring readers observe a
complete old or new value. A failed write leaves the prior state intact and
cleans up the temporary file where possible.

## Testing

Unit tests remain fast, deterministic, and filesystem-independent where domain
logic is involved. They use practical fakes rather than mocks.

Coverage includes:

1. Catalog schema parsing and each referential invariant.
2. Missing-state default selection and invalid-state failures.
3. Exact GPT and Claude resolution for all four roles.
4. User-role overlay while project and unconfigured agents remain untouched.
5. A single profile snapshot across parallel and chained work.
6. CLI argument handling and state-write behavior through fakes.
7. Failure before any backend starts.
8. Existing direct-front-matter agent behavior remains compatible.

A focused manual QA procedure verifies the deployed CLI, state file, status
output, and next-invocation routing for GPT and Claude. Production-model calls
remain manual, use a disposable repository, and stay outside hooks and CI.

Because Bun has no general expected-failure mechanism, contract/test and
implementation commits follow the repository's local red-green protocol and
are published together only at a green branch tip.

## Migration

1. Deploy the versioned static catalog.
2. Add and test runtime profile resolution without removing current rendered
   routing.
3. Add the CLI and verify selection-state behavior.
4. Convert the four role files from `.md.tmpl` to backend-neutral `.md` files.
5. Remove the obsolete chezmoi data and shared front-matter template.
6. Apply managed targets and verify exactly four generic user agents remain.
7. Confirm missing state defaults to GPT, preserving current behavior.

The migration is complete only when source state, deployed targets, CLI status,
and extension resolution agree, and the repository test suite is green.
