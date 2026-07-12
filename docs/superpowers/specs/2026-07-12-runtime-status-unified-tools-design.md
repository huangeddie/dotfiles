# Runtime status: unified tool distribution

**Date:** 2026-07-12  
**Status:** Approved

## Goal

Remove the separate file-operation category. Classify all ordinary Pi tool
execution—including `read`, `write`, `edit`, Bash, and every other tool—as tool
wait.

The distinction remains between model/provider time and local tool execution:
model generation of tool arguments and model ingestion of tool results are
model time; only the execution interval from `tool_execution_start` through
`tool_execution_end` is tool time.

## Distribution contract

```ts
type RuntimeDistribution = {
  wallMillis: number;
  modelMillis: number;
  toolWaitMillis: number;
  idleMillis: number;
  unaccountedMillis: number;
};
```

Every snapshot satisfies:

```text
wallMillis = modelMillis
           + toolWaitMillis
           + idleMillis
           + unaccountedMillis
```

The categories mean:

- `modelMillis`: provider/model intervals, including generating tool calls and
  processing tool results;
- `toolWaitMillis`: every ordinary root tool execution interval, child tool
  time, and subagent wrapper overhead;
- `idleMillis`: explicitly settled session time;
- `unaccountedMillis`: uncovered time inside an active processing envelope.

TPS continues to use only provider/model duration.

## Exclusive timeline

The timeline no longer accepts a root-tool classification. Its tool boundary is:

```ts
startTool(toolCallId: string, now: number): void;
```

Inside an active processing envelope, exclusive precedence is:

1. an owning reported subagent uses the proportional child distribution;
2. any ordinary root tool interval is tool wait;
3. a provider interval is model time;
4. remaining time is unaccounted.

Outside an active processing envelope, time is idle. Parallel ordinary tools
remain a wall-clock union. Reported subagents retain deterministic start-order
ownership. Child-attributable time replaces its parent Bash interval; wrapper,
startup, shutdown, and report overhead remain root tool wait.

## Recursive telemetry

The strict report remains version 2 but removes `fileOpsMillis`:

```ts
type RuntimeStatusReport = {
  version: 2;
  observedMillis: number;
  modelMillis: number;
  toolWaitMillis: number;
  idleMillis: number;
  unaccountedMillis: number;
};
```

Invariant:

```text
observedMillis = modelMillis
               + toolWaitMillis
               + idleMillis
               + unaccountedMillis
```

There is no backward compatibility requirement. Reports containing the old
five-category shape fail strict validation and leave their parent interval as
ordinary tool wait.

## Pi adapter and UI

The extension passes every `tool_execution_start` directly to the timeline. It
no longer owns a tool-name classification policy.

The status removes the `files` portion:

```text
⏱ 2m 14s | 38.7 t/s | gen 12.0s 9% | tools 5.0s 4% | idle 1m 55s 86% | other 2.0s 1%
```

All percentages use session walltime. Existing stopwatch, settled-idle,
unaccounted, session lifecycle, shutdown snapshot, privacy, cleanup, and
best-effort publication behavior remain unchanged.

## Verification

Fast deterministic unit tests cover:

1. strict four-category version-2 report validation and scaling;
2. `read`, `write`, and `edit` intervals accumulating as tool wait;
3. overlapping ordinary tools counting as a wall-clock union;
4. tool precedence over overlapping provider intervals;
5. recursive child attribution across model/tool/idle/unaccounted categories;
6. status rendering without a `files` portion;
7. TPS remaining provider/model-only;
8. every snapshot summing exactly to session walltime.

The manual QA procedure must describe all ordinary tools under `tools` and
remove file-operation observations. `~/.pi/agent/runtime-status-core.ts` and
`~/.pi/agent/extensions/runtime-status.ts` are one deployment unit: before
applying, it must run a target-scoped `chezmoi diff` for each target; it must
apply both targets together with a target-scoped command; and after applying,
it must run a target-scoped `chezmoi diff` for each target and require both to
be empty. It must never use global `chezmoi apply`, so unrelated deployed drift
is not overwritten. Interactive Pi/provider QA remains user-assisted and
outside automated tests, hooks, and CI.

## Out of scope

- Estimating end-to-end model time associated with a particular tool result.
- Tool-name-specific timing categories.
- Per-tool or per-subagent status breakdowns.
- Backward compatibility with the superseded five-category version-2 report.
