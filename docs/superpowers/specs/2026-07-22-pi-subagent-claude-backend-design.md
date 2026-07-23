# Pi Subagent Claude Backend Design

**Date:** 2026-07-22

## Goal

Extend the chezmoi-managed Pi `subagent` extension so each agent definition can select either a non-interactive Pi process or Claude Code as its backend. Preserve the existing single, parallel, and chain behavior while giving both backends one normalized execution, rendering, error, and usage contract.

## Scope

This change:

- adds per-agent backend selection;
- adds four Claude-backed managed agents;
- renames the four existing Pi-backed agents with a `gpt-` prefix;
- supports mixed-backend parallel and chain workflows;
- preserves live progress, cancellation, rendering, bounded model-visible output, and usage accounting;
- keeps the existing workflow prompt names and routes them to the renamed `gpt-*` agents.

This change does not add a global backend switch, an invocation-level backend override, Claude-specific workflow templates, compatibility aliases for old agent names, automatic backend fallback, or nested subagent support.

## Agent definition contract

Backend selection belongs to the agent Markdown frontmatter. It is not part of the `subagent` tool parameters.

### Pi agent

A missing `backend` defaults to `pi` for compatibility. Pi definitions retain optional `model` and `tools` fields.

```yaml
---
name: gpt-worker
description: General-purpose GPT worker
model: openai-codex/gpt-5.6-terra
---
```

The existing Pi invocation behavior remains the default for user and project agent definitions that do not declare a backend.

### Claude agent

A Claude definition declares `backend: claude`. Both `model` and a non-empty, backend-native `tools` list are required.

```yaml
---
name: claude-worker
description: General-purpose Claude Code worker
backend: claude
model: sonnet
tools: Read, Write, Edit, Glob, Grep, Bash, WebSearch, WebFetch
---
```

Claude tool names are passed through as Claude-native values. The extension does not maintain a Pi-to-Claude tool-name translation table. An agent definition may not expose the Claude `Agent` tool because nested delegation is prohibited.

Unknown backend values, missing Claude fields, empty tool lists, and explicit `Agent` access make the definition invalid. Discovery retains file- and agent-specific diagnostics so selecting an invalid definition produces an actionable error instead of an undifferentiated “unknown agent” result. Claude remains responsible for validating version-specific model and tool names at process startup.

Project agents retain the existing trust confirmation behavior and override user agents with the same name when scope is `both`.

## Managed agent names

The installed agent set becomes:

| Pi backend | Claude backend |
| --- | --- |
| `gpt-scout` | `claude-scout` |
| `gpt-planner` | `claude-planner` |
| `gpt-reviewer` | `claude-reviewer` |
| `gpt-worker` | `claude-worker` |

The unprefixed `scout`, `planner`, `reviewer`, and `worker` definitions are removed without compatibility aliases.

Claude models and tools are:

| Agent | Model | Tools |
| --- | --- | --- |
| `claude-scout` | `haiku` | `Read, Grep, Glob, Bash, WebSearch, WebFetch` |
| `claude-planner` | `sonnet` | `Read, Grep, Glob, WebSearch, WebFetch` |
| `claude-reviewer` | `sonnet` | `Read, Grep, Glob, Bash, WebSearch, WebFetch` |
| `claude-worker` | `sonnet` | `Read, Write, Edit, Glob, Grep, Bash, WebSearch, WebFetch` |

The Claude definitions reuse the corresponding role prompts. Existing workflow templates retain `/implement`, `/scout-and-plan`, and `/implement-and-review`, but their agent references change to `gpt-*`. No Claude-specific workflow templates are added.

## Backend-neutral execution contract

The extension replaces its Pi-specific message representation with these backend-neutral requests, events, and results:

```ts
type Backend = "pi" | "claude";

type DisplayEvent =
  | { type: "text"; text: string }
  | { type: "toolCall"; name: string; args: Record<string, unknown> };

interface AgentRunRequest {
  agent: AgentConfig;
  task: string;
  cwd: string;
  step?: number;
}

interface AgentRunResult {
  backend: Backend;
  agent: string;
  agentSource: "user" | "project";
  task: string;
  status: "running" | "completed" | "failed" | "aborted";
  output: string;
  events: DisplayEvent[];
  usage: UsageStats;
  model?: string;
  exitCode?: number;
  diagnostic?: string;
  step?: number;
}

interface SubagentBackend {
  run(
    request: AgentRunRequest,
    signal: AbortSignal | undefined,
    onUpdate?: (result: AgentRunResult) => void,
  ): Promise<AgentRunResult>;
}
```

`PiBackend` and `ClaudeBackend` own backend-specific argument construction and event normalization. Single, parallel, chain, truncation, and rendering logic consume only `AgentRunResult`.

Process creation is a hard-to-test effect behind a narrow, injected process-runner interface owned by the backend adapters. The production composition root wires Node process spawning. Unit tests use a practical fake that supplies stdout lines, stderr chunks, exit status, and abort behavior.

## Pi invocation

The Pi adapter preserves the current non-interactive JSON-mode invocation, model selection, system-prompt behavior, working directory, and tool allowlist behavior. It always excludes the `subagent` tool, including when no explicit tool allowlist exists or a definition attempts to include it.

Pi JSON events are normalized into text, tool-call, usage, model, completion, abort, and error fields. Native Pi `Message` objects do not cross the backend boundary.

## Claude invocation and permissions

A Claude run is equivalent to:

```text
claude -p
  --output-format stream-json
  --verbose
  --no-session-persistence
  --model <model>
  --tools <comma-separated tools>
  --allowedTools <comma-separated tools>
  --disallowedTools Agent
  --permission-mode dontAsk
  --append-system-prompt <agent body>
```

The task is supplied through stdin rather than exposed in the process argument list. The child runs in the requested working directory.

The permission contract has four layers:

1. `--tools` exposes exactly the declared backend-native tools.
2. `--allowedTools` pre-authorizes those tools for non-interactive execution.
3. `--permission-mode dontAsk` denies any operation that is not pre-authorized instead of attempting an unavailable interactive prompt.
4. `--disallowedTools Agent` prevents nested Claude subagents as defense in depth.

The adapter never passes a dangerous permission-bypass flag.

Claude runs in its normal environment. Applicable `CLAUDE.md` files, user/project/local settings, authentication, hooks, plugins, and other normal Claude Code behavior remain active. These local configurations can further constrain or affect a run and are deliberately not disabled.

The Claude stream parser normalizes:

- assistant text blocks into text display events;
- `tool_use` blocks into tool-call display events;
- the final result into canonical output and completion status;
- model, token, cache, turn, context, and cost fields when supplied;
- permission denials, error results, malformed non-empty events, and abnormal exits into diagnostics.

Blank stream lines are ignored. A successful process that never produces a valid final result is a failed run rather than a successful empty response.

## Orchestration and data flow

For each tool call:

1. Discover and validate user/project agent definitions.
2. Confirm requested project-local agents under the existing trust policy.
3. Resolve each requested agent to its backend-specific configuration.
4. Route each run through the matching backend adapter.
5. Normalize progress into `AgentRunResult` updates.
6. Apply existing single, parallel, or chain orchestration.
7. Render and return backend-neutral results.

Parallel mode retains a maximum of eight tasks and four concurrent processes. A single parallel call may mix GPT and Claude agents. Each result keeps its input order regardless of completion order.

Chain mode remains sequential and replaces every `{previous}` placeholder with the preceding canonical output. A chain may cross backend boundaries. It stops at the first failed or aborted step.

There is no automatic retry or fallback to another backend. Backend choice controls model, cost, permissions, configuration, and behavior and therefore must remain explicit.

## Cancellation and process lifecycle

The shared process runner observes the parent abort signal. On abort it closes child stdin, sends `SIGTERM`, and escalates to `SIGKILL` after the grace period if needed. It removes abort listeners and timers after process completion. An abort produces `status: "aborted"`, distinct from process or backend failure.

One task’s ordinary failure does not cancel unrelated parallel siblings. A parent abort propagates to every active child.

## Rendering, output, and usage

Tool call and result rendering displays agent, backend, model, status, normalized tool activity, and usage. Tool-call formatting recognizes both Pi-style names such as `read` and Claude-style names such as `Read`, including their differing path and argument fields.

Model-visible output is capped at 50 KB per task in single, parallel, and chain modes. Truncation is UTF-8 safe and states how much output was omitted. Full normalized events remain in tool-result details for expanded rendering.

Usage normalization covers input tokens, output tokens, cache reads, cache writes, cost, context tokens, and turns where the backend supplies them. Missing metrics remain zero rather than being estimated. Final aggregate child usage is returned through Pi’s nested tool `usage` field so session totals account for both Pi and Claude child model calls without counting streaming updates more than once.

## Error handling

Failures are represented consistently:

- invalid parameters identify the accepted invocation modes;
- invalid agent definitions identify their source file and violated field contract;
- unknown agents list valid discovered agents and surface a same-name invalid-definition diagnostic when available;
- spawn errors identify the missing or unlaunchable backend executable;
- authentication and permission failures retain useful backend diagnostics;
- malformed streams and missing final results fail explicitly;
- nonzero exits include stderr and any normalized backend output;
- backend-reported aborts remain distinct from failures.

Single mode reports its failed agent. Parallel mode reports every task independently and preserves successful sibling output. Chain mode identifies the failed step and does not launch later steps.

## Testing

Automated tests are deterministic unit tests and never launch Pi, Claude, a terminal UI, or a network request.

### Agent schema

Tests cover:

- missing backend defaulting to `pi`;
- valid Pi and Claude definitions;
- required Claude model and tool fields;
- unknown backends, empty lists, and forbidden `Agent` access;
- file-specific diagnostics;
- user/project precedence.

Parsing logic is pure where practical. Filesystem discovery uses a narrow file-source boundary or a practical fake rather than production home directories.

### Invocation contracts

Pure argument-builder tests cover:

- Pi model, prompt, and tool arguments;
- unconditional Pi `subagent` exclusion;
- Claude model and exact tool exposure/pre-authorization;
- Claude `Agent` denial, `dontAsk`, stream format, and disabled session persistence;
- task delivery through stdin;
- absence of permission bypass and setting-source restrictions.

### Stream parsers

Static Pi JSONL and Claude stream-JSON fixtures cover:

- assistant text and tool calls;
- final output;
- usage, cache, cost, model, and turns;
- permission denial;
- malformed events;
- backend error and abort results;
- missing final result.

Equivalent backend fixtures normalize to the same result schema.

### Orchestration

Fake backends verify:

- single execution;
- mixed-backend parallel execution with deterministic result ordering;
- cross-backend `{previous}` chains;
- chain short-circuiting;
- independent parallel failure;
- parent cancellation;
- UTF-8-safe output truncation;
- aggregate usage without double counting.

No unit test depends on timing, sampling, production credentials, or global configuration.

## Manual QA

A manual-only QA procedure exercises production hard-to-test boundaries:

1. one real `gpt-*` invocation;
2. one real `claude-*` invocation with a tool call;
3. mixed GPT/Claude parallel execution;
4. a cross-backend chain;
5. cancellation;
6. an intentional Claude permission or configuration failure;
7. usage and expanded rendering inspection.

The QA procedure is not added to pre-commit, pre-push, or CI pipelines.

## Deployment

All edits target chezmoi source state under `dot_pi/agent`. After tests pass, inspect `chezmoi diff`, apply the managed Pi configuration, and perform manual QA against deployed files under `~/.pi/agent`. The implementation remains vendored and reproducible rather than depending on a transient upstream example path.
