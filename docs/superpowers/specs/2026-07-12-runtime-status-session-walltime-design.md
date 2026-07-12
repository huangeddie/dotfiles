# Runtime status: explicit session walltime accounting

**Date:** 2026-07-12  
**Status:** Approved

## Goal

Add a stopwatch for the complete Pi session, from `session_start` through
`session_shutdown`, and classify every millisecond without hiding missing
instrumentation in the idle category.

The runtime status must distinguish explicitly known inactivity from time inside
active processing that no provider or tool lifecycle interval explains.

## Distribution contract

A runtime snapshot has this shape:

```ts
type RuntimeDistribution = {
  wallMillis: number;
  generatingMillis: number;
  toolWaitMillis: number;
  idleMillis: number;
  unaccountedMillis: number;
};
```

All fields are finite, non-negative integer milliseconds. Every snapshot must
satisfy:

```text
wallMillis = generatingMillis
           + toolWaitMillis
           + idleMillis
           + unaccountedMillis
```

The categories mean:

- `generatingMillis`: time covered by a recorded root provider/turn interval or
  attributed child generation.
- `toolWaitMillis`: time covered by an ordinary root tool interval, child tool
  time, or subagent wrapper overhead.
- `idleMillis`: time when Pi is explicitly settled and waiting for input,
  including initial and final settled session time.
- `unaccountedMillis`: time inside an active processing envelope that is not
  covered by a provider or tool interval, including lifecycle gaps and
  orchestration work for which Pi exposes no more specific event.

The stopwatch is authoritative for the session boundary, but residual time is
classified as `unaccountedMillis`, never blindly as idle.

## Lifecycle boundaries

Session walltime starts at `session_start` and ends at `session_shutdown`.
The live snapshot uses the current time as the provisional end.

Pi may retry or compact after `agent_end`, so `agent_end` is not proof that Pi is
waiting for the user. Explicit idle and active-processing envelopes use these
boundaries:

- `session_start` to the first `before_agent_start`: idle;
- `before_agent_start` to `agent_settled`: active processing;
- `agent_settled` to the next `before_agent_start`: idle;
- the final `agent_settled` to `session_shutdown`: idle.

A low-level `agent_end` does not open an idle interval. Time between an
`agent_end` and an automatic retry, compaction, or eventual `agent_settled`
therefore remains in the active envelope and is classified by the available
provider/tool events or as unaccounted.

The status render timer runs for the complete session, including while Pi waits
for input. It refreshes the display only; it does not increment accounting
counters. Timestamped lifecycle boundaries make accounting independent of timer
drift, event-loop stalls, and suspended rendering.

## Exclusive interval classification

Build a deterministic timeline from session, active-envelope, root provider,
and root tool boundaries. Split walltime at every relevant boundary and assign
each segment exactly once.

Classification rules are:

1. A segment outside an active-processing envelope is idle.
2. Within an active envelope, an owning reported subagent tool uses the child's
   proportional distribution.
3. Otherwise, a segment covered by any ordinary root tool is tool wait.
4. Otherwise, a segment covered by a root provider interval is generating.
5. Remaining active-envelope time is unaccounted.

The existing deterministic start-order ownership rule applies when reported
subagents overlap. Ordinary overlapping tools continue to count as a wall-clock
union rather than a sum. Tool precedence over root provider intervals prevents
double-counting under unusual or overlapping event order.

Subagent startup, shutdown, command-wrapper, and report-file overhead remain
root tool wait. Child-attributable time is scaled to the child category ratios
with deterministic, total-preserving integer rounding, as in the existing
exclusive telemetry design.

## Recursive telemetry schema

A child publishes only this strict report version:

```ts
type RuntimeStatusReport = {
  version: 2;
  observedMillis: number;
  generatingMillis: number;
  toolWaitMillis: number;
  idleMillis: number;
  unaccountedMillis: number;
};
```

The required invariant is:

```text
observedMillis = generatingMillis
               + toolWaitMillis
               + idleMillis
               + unaccountedMillis
```

Version 1 is unsupported. A missing, invalid, or unsupported report is ignored,
and the corresponding parent interval remains ordinary tool wait. No migration,
compatibility union, or category conversion is required.

All existing privacy, managed-path validation, atomic publication, cleanup, and
non-fatal telemetry behavior remain unchanged.

## State and boundaries

Pure accounting code owns timestamped interval contracts and snapshot
classification. It receives `now` explicitly and has no dependency on the
filesystem, Pi runtime, or render timer.

The extension is the composition root for effects:

- Pi lifecycle events provide timestamps and interval transitions;
- `Date.now()` supplies the clock at the outer boundary;
- `setInterval` requests periodic UI refreshes;
- the existing `ReportStore` handles child report I/O.

Token and TPS accounting remain independent. Session token throughput still
uses model generation time rather than session walltime as its denominator.

## UI

The live status is:

```text
⏱ 2m 14s | 38.7 t/s | gen 12s 9% | tools 5s 4% | idle 1m 55s 86% | other 2s 1%
```

`other` is the display label for `unaccountedMillis`. All percentages use
`wallMillis` as their denominator. A zero-duration session displays zero for all
percentages.

The stopwatch uses a compact duration:

- below one minute: `8s`;
- below one hour: `2m 14s`;
- one hour or more: `1h 03m 12s`.

At `session_start`, reset state, start the render timer, and show the initial
status when UI is available. Do not stop the timer at `agent_end` or
`agent_settled`. At `session_shutdown`, finalize the snapshot and child report,
stop the timer, and clear the status.

## Error handling

Malformed, duplicate, missing, or out-of-order lifecycle events must not produce
negative durations or violate the snapshot total. Ignore unmatched interval-end
events. Repeated starts for an already-open interval must not create duplicate
coverage. Session reset discards all intervals from the prior extension
instance.

An accounting gap is represented as `unaccountedMillis`; it must not be hidden
by relabeling it idle. Existing best-effort subagent telemetry failures remain
non-fatal.

## Verification

Fast deterministic unit tests use explicit timestamps and no real timer, clock,
Pi runtime, filesystem, or network. They cover:

1. session walltime starts at `session_start` and advances while settled;
2. initial, between-run, and final settled intervals are idle;
3. uncovered active-envelope intervals are unaccounted;
4. `agent_end` before retry or `agent_settled` does not begin idle;
5. provider and tool intervals classify active time with deterministic
   precedence;
6. overlapping ordinary tools count as a wall-clock union;
7. overlapping subagents preserve exclusive start-order ownership;
8. every snapshot category sums exactly to session walltime;
9. strict version-2 report validation and rejection of version 1;
10. recursive version-2 child attribution, scaling, and wrapper overhead;
11. stopwatch formatting below one minute, below one hour, and at least one
    hour;
12. percentages use session walltime and `other` renders explicitly;
13. `agent_end` and `agent_settled` leave the session render timer running;
14. session reset, replacement, reload, and shutdown finalize or discard the
    correct intervals.

No UI or system test is required. The existing manually invoked subagent
telemetry QA may be updated for the new report schema and status text, but it
must remain outside automated hooks and CI.

## Out of scope

- Persisting walltime or distributions in session JSONL.
- Restoring elapsed stopwatch state when resuming a historical session; timing
  starts at the new runtime's `session_start`.
- Per-agent or per-subagent UI breakdowns.
- Treating inferred residual time as idle.
- Backward compatibility with telemetry report version 1.
