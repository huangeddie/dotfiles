# Runtime status: recursive subagent telemetry

**Date:** 2026-07-10  
**Status:** Approved

## Goal

Attribute a `pi-subagent` subprocess's model-generation, tool-wait, and idle
wall time to the invoking Pi session without exposing telemetry to the root
agent's LLM context.

The root display uses **exclusive wall-clock accounting**: its categories always
sum to the root agent's observed elapsed time. A subagent's elapsed interval is
therefore reclassified from parent tool-wait time into the child distribution;
it is never counted twice.

## Data schema and contract

A child process may publish this JSON document to the file named by
`PI_RUNTIME_STATUS_REPORT_PATH`:

```ts
type RuntimeStatusReport = {
  version: 1;
  observedMillis: number;
  generatingMillis: number;
  toolWaitMillis: number;
  idleMillis: number;
};
```

All duration fields are finite, non-negative integer milliseconds. The required
invariant is:

```text
observedMillis = generatingMillis + toolWaitMillis + idleMillis
```

The child writes a report only when the environment variable contains a managed
report path: an absolute `report.json` below the operating-system temporary
directory in a `pi-runtime-status-*` directory. It writes atomically with
restrictive permissions. Reports are private files; they must not be printed to
stdout or stderr, added to a tool result, appended to Pi session entries, or
otherwise placed in LLM context.

A missing, unreadable, malformed, unsupported-version, or invariant-violating
report is ignored. That failure changes neither subagent execution nor its
normal response. The parent retains the corresponding time as ordinary tool
wait.

## Components and responsibilities

### `runtime-status` extension

The extension owns the telemetry schema, validation, report serialization,
exclusive reattribution, and status rendering.

When a `bash` tool call invokes `pi-subagent`, the extension creates a unique
private report path and mutates the command to export that path only for the
subprocess. It records the mapping from Pi tool-call ID to report path and the
actual parent tool interval.

At the matching tool completion, it reads and deletes the report. The
extension records every root-tool interval and builds an exclusive timeline by
sweeping their boundaries. At an instant with multiple active tools, a reported
subagent owns the interval in tool-call start order; otherwise an active
ordinary tool owns it. This deterministic precedence is needed because a
single wall-clock instant cannot be assigned to two categories.

For a subagent that owns `ownedMillis` of its measured parent interval
`parentSubagentToolMillis`, the attributable child time is:

```text
attributable = ownedMillis * min(1, report.observedMillis / parentSubagentToolMillis)
```

The report's three category ratios divide `attributable`, with deterministic
integer rounding that preserves it exactly. The remaining owned subagent time,
any overlap owned by a different tool, and all subprocess startup, shutdown,
or report-file overhead remain root tool wait. Thus overlapping ordinary tools
are counted as a union, overlapping subagents do not double count, and the
root total cannot exceed root elapsed time.

The extension derives tool time from this interval ledger rather than from a
single start timestamp. This corrects the current undercount of concurrently
executing tools while allowing independent reattribution of each subagent.

At child shutdown, the same extension includes any recursively merged
grandchild attribution in its final report. Thus every report is already an
exclusive, complete subtree distribution.

### `pi-subagent` wrapper

The wrapper remains transport-only. It inherits the exported environment while
launching `pi -p`; it neither parses nor prints telemetry. No interface or
user-visible output changes are required.

## Data flow

1. Root Pi calls `bash` with `pi-subagent <prompt>`.
2. Root extension allocates report path `R1`, stores it by tool-call ID, and
   prefixes the command with an export of `PI_RUNTIME_STATUS_REPORT_PATH=R1`.
3. `pi-subagent` launches its child `pi -p`; normal environment inheritance
   passes `R1` to that child.
4. The child observes its own events. A nested `pi-subagent` call follows the
   same process with a distinct path, and the child reattributes the nested
   report locally.
5. On completion, the child atomically writes its aggregate report to `R1`.
6. The root extension reads, validates, merges, and removes `R1` during the
   matching `tool_execution_end`. The LLM sees only normal bash output.

## Error handling and security

- The parent creates an absolute unique `report.json` path in a mode-`0700`
  `pi-runtime-status-*` directory under the operating system temporary
  directory; the child accepts only this managed path shape and writes files
  with mode `0600`.
- Never follow an arbitrary report path supplied by tool output; the parent
  reads only a path it created and associated with a tool-call ID.
- Delete report files in success, validation failure, cancellation, and session
  shutdown paths on a best-effort basis.
- Preserve current behavior when no report path exists; interactive, print,
  JSON, and RPC modes continue to work.
- A report write failure is intentionally non-fatal and must not alter Pi's
  exit code or response.

## Verification

Fast deterministic unit tests cover:

1. report validation: valid schema, bad version, non-finite/negative values,
   and violated total invariant;
2. deterministic rescaling and rounding while preserving the parent interval;
3. successful reattribution: the root elapsed total is unchanged and child
   categories replace only child-attributable parent tool time;
4. child report longer than its observed parent interval;
5. missing or invalid reports: no reattribution;
6. nested aggregation: a child report already containing grandchild work merges
   once, without double-counting;
7. overlapping root ordinary tools: union-based tool timing counts wall time
   rather than the sum of concurrent durations;
8. overlapping subagents: stable ownership precedence and rescaling preserve
   root elapsed time without double-counting either report.

No UI/system test is required. Temporary-file integration behavior is isolated
behind a narrow report-store interface and covered with a practical fake.

## Out of scope

- Displaying a per-subagent breakdown in the UI.
- Persisting telemetry in session JSONL.
- Adding telemetry to arbitrary shell commands or other subagent transports.
- Altering `pi-subagent` normal stdout/stderr behavior.
