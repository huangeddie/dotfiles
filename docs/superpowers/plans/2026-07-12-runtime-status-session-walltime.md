# Runtime Status Session Walltime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a session-lifetime stopwatch and partition its walltime into explicitly observed generation, tools, settled idle, and unaccounted active-processing time.

**Architecture:** A pure `RuntimeTimeline` in `runtime-status-core.ts` owns timestamped session, processing-envelope, provider, and tool intervals and projects an exclusive four-category snapshot. The Pi extension is the composition root: lifecycle events feed timestamps into the timeline, the render timer only refreshes UI, and the existing report-store boundary transports strict version-2 recursive telemetry.

**Tech Stack:** TypeScript, Pi extension lifecycle API, Bun 1.3 test runner, Node filesystem APIs, chezmoi source-state workflow.

## Global Constraints

- `wallMillis = generatingMillis + toolWaitMillis + idleMillis + unaccountedMillis` for every snapshot.
- Idle means only time when Pi is explicitly outside `before_agent_start`–`agent_settled`; uncovered time inside that envelope is `unaccountedMillis`.
- Tool classification takes precedence over root provider classification, and overlapping tools count exclusive walltime rather than summed durations.
- Recursive telemetry supports only report `version: 2`; version 1 is rejected without migration.
- Child report and filesystem failures remain private, best-effort, and non-fatal.
- TPS continues to use provider-generation duration, not session walltime.
- Unit tests must use explicit timestamps and practical fakes; no real clocks, timers, filesystem, network, UI, or sampling.
- QA remains manual and must not be added to Bun tests, hooks, or CI.
- Edit chezmoi source-state paths under `/Users/eddiehuang/.local/share/chezmoi`; apply only after source tests pass.
- Follow red-green commits: Bun supports `test.failing`, so RED commits contain executable expected-failure assertions and interface stubs; GREEN commits remove markers and add implementation.

---

## File map

- Modify `dot_pi/agent/runtime-status-core.ts`: strict v2 report contract, four-category scaling, exclusive `RuntimeTimeline`, and narrow report sink contract.
- Modify `dot_pi/agent/exact_extensions/runtime-status.ts`: session lifecycle wiring, TPS state, status formatting, report publication, timer lifetime, and report-store effects.
- Modify `tests/runtime-status.test.ts`: deterministic contract and unit tests using fake report/filesystem boundaries.
- Modify `docs/qa/runtime-status-subagent-telemetry.md`: manual checks for stopwatch, explicit idle, `other`, and bounded recursive totals.

---

### Task 1: Strict version-2 recursive telemetry contract

**Files:**
- Modify: `dot_pi/agent/runtime-status-core.ts:1-109`
- Modify: `dot_pi/agent/exact_extensions/runtime-status.ts:650-668`
- Test: `tests/runtime-status.test.ts:1-299`

**Interfaces:**
- Produces: `RuntimeStatusReport` with literal `version: 2` and `unaccountedMillis`.
- Produces: `RuntimeCategoryMillis` with all four category fields.
- Produces: `scaleReport(report: RuntimeStatusReport, targetMillis: number): RuntimeCategoryMillis`.
- Preserves: `ReportStore`, `validateRuntimeStatusReport`, and `publishChildReport` names.

- [ ] **Step 1: Add the RED report contract and expected-failure assertions**

Change the core contracts first:

```ts
export type RuntimeStatusReport = {
  version: 2;
  observedMillis: number;
  generatingMillis: number;
  toolWaitMillis: number;
  idleMillis: number;
  unaccountedMillis: number;
};

export type RuntimeCategoryMillis = Pick<
  RuntimeStatusReport,
  "generatingMillis" | "toolWaitMillis" | "idleMillis" | "unaccountedMillis"
>;
```

Add `unaccountedMillis: 0` to temporary category-return stubs and all existing typed report fixtures so TypeScript compiles. Change report literals to `version: 2`. Temporarily leave validation/scaling behavior unchanged so these real assertions are expected failures:

```ts
test.failing("accepts only a v2 report whose four categories sum exactly", () => {
  const valid: RuntimeStatusReport = {
    version: 2,
    observedMillis: 10,
    generatingMillis: 4,
    toolWaitMillis: 3,
    idleMillis: 2,
    unaccountedMillis: 1,
  };

  expect(validateRuntimeStatusReport(valid)).toEqual(valid);
  expect(validateRuntimeStatusReport({ ...valid, version: 1 })).toBeNull();
  expect(validateRuntimeStatusReport({ ...valid, unaccountedMillis: -1 })).toBeNull();
  expect(validateRuntimeStatusReport({ ...valid, generatingMillis: 4.5 })).toBeNull();
  expect(validateRuntimeStatusReport({ ...valid, observedMillis: 11 })).toBeNull();
});

test.failing("scales all four report categories with total-preserving rounding", () => {
  expect(scaleReport({
    version: 2,
    observedMillis: 4,
    generatingMillis: 1,
    toolWaitMillis: 1,
    idleMillis: 1,
    unaccountedMillis: 1,
  }, 10)).toEqual({
    generatingMillis: 3,
    toolWaitMillis: 3,
    idleMillis: 2,
    unaccountedMillis: 2,
  });
});
```

Update every non-failing existing equality expectation for category objects to include `unaccountedMillis: 0`. In the extension's temporary shutdown report literal, use `version: 2` and `unaccountedMillis: 0` solely as a compilation stub; Task 3 replaces it with the real snapshot value.

- [ ] **Step 2: Run the contract tests and verify anticipated failures**

Run:

```bash
bun test tests/runtime-status.test.ts
```

Expected: exit 0; the two `test.failing` cases report as passing expected failures, with no ordinary failures.

- [ ] **Step 3: Commit the Track A contract**

```bash
git add dot_pi/agent/runtime-status-core.ts dot_pi/agent/exact_extensions/runtime-status.ts tests/runtime-status.test.ts
git commit -m "test: specify runtime telemetry v2 contract"
```

- [ ] **Step 4: Implement strict validation and four-category scaling**

Use the complete category list and invariant:

```ts
const categories = [
  "generatingMillis",
  "toolWaitMillis",
  "idleMillis",
  "unaccountedMillis",
] as const;

export function validateRuntimeStatusReport(value: unknown): RuntimeStatusReport | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 2) return null;
  if (
    !isMillis(candidate.observedMillis) ||
    !isMillis(candidate.generatingMillis) ||
    !isMillis(candidate.toolWaitMillis) ||
    !isMillis(candidate.idleMillis) ||
    !isMillis(candidate.unaccountedMillis)
  ) return null;
  if (
    candidate.observedMillis !==
    candidate.generatingMillis + candidate.toolWaitMillis +
      candidate.idleMillis + candidate.unaccountedMillis
  ) return null;
  return value as RuntimeStatusReport;
}
```

Retain the existing largest-remainder scaling algorithm, now over four entries, and return:

```ts
return {
  generatingMillis: floors[0],
  toolWaitMillis: floors[1],
  idleMillis: floors[2],
  unaccountedMillis: floors[3],
};
```

The zero-target branch must return all four zero fields. Remove `.failing` from the two report tests.

- [ ] **Step 5: Run the focused suite and verify GREEN**

Run:

```bash
bun test tests/runtime-status.test.ts
```

Expected: all tests pass with zero expected failures.

- [ ] **Step 6: Commit the Track B implementation**

```bash
git add dot_pi/agent/runtime-status-core.ts tests/runtime-status.test.ts
git commit -m "feat: enforce runtime telemetry v2 reports"
```

---

### Task 2: Pure exclusive session timeline

**Files:**
- Modify: `dot_pi/agent/runtime-status-core.ts:111-end`
- Test: `tests/runtime-status.test.ts:100-180`

**Interfaces:**
- Consumes: strict `RuntimeStatusReport`, `RuntimeCategoryMillis`, `scaleReport`, and `validateRuntimeStatusReport` from Task 1.
- Produces: `RuntimeDistribution`, `SubagentReportSink`, and `RuntimeTimeline`.
- Produces methods: `reset()`, `startSession(now)`, `startProcessing(now)`, `settle(now)`, `startProvider(now)`, `endProvider(now)`, `startTool(id, now)`, `endTool(id, now)`, `attachSubagentReport(id, report)`, `shutdown(now)`, and `snapshot(now)`.

- [ ] **Step 1: Add timeline interfaces, method stubs, and expected-failure tests**

Add contracts:

```ts
export type RuntimeDistribution = RuntimeCategoryMillis & {
  wallMillis: number;
};

export type SubagentReportSink = {
  attachSubagentReport(toolCallId: string, report: RuntimeStatusReport): void;
};

export class RuntimeTimeline implements SubagentReportSink {
  reset(): void {}
  startSession(_now: number): void {}
  startProcessing(_now: number): void {}
  settle(_now: number): void {}
  startProvider(_now: number): void {}
  endProvider(_now: number): void {}
  startTool(_toolCallId: string, _now: number): void {}
  endTool(_toolCallId: string, _now: number): void {}
  attachSubagentReport(_toolCallId: string, _report: RuntimeStatusReport): void {}
  shutdown(_now: number): void {}
  snapshot(_now: number): RuntimeDistribution {
    return {
      wallMillis: 0,
      generatingMillis: 0,
      toolWaitMillis: 0,
      idleMillis: 0,
      unaccountedMillis: 0,
    };
  }
}
```

Add executable contract tests:

```ts
test.failing("partitions settled and uncovered active session walltime", () => {
  const timeline = new RuntimeTimeline();
  timeline.startSession(0);
  timeline.startProcessing(1_000);
  timeline.startProvider(1_500);
  timeline.endProvider(2_500);
  timeline.startTool("tool", 3_000);
  timeline.endTool("tool", 4_000);
  timeline.settle(5_000);

  expect(timeline.snapshot(8_000)).toEqual({
    wallMillis: 8_000,
    generatingMillis: 1_000,
    toolWaitMillis: 1_000,
    idleMillis: 4_000,
    unaccountedMillis: 2_000,
  });
});

test.failing("keeps agent-end retry gaps active until agent_settled", () => {
  const timeline = new RuntimeTimeline();
  timeline.startSession(0);
  timeline.startProcessing(1_000);
  // A low-level agent_end produces no timeline transition.
  timeline.startProvider(2_000);
  timeline.endProvider(3_000);
  timeline.settle(5_000);
  expect(timeline.snapshot(6_000)).toEqual({
    wallMillis: 6_000,
    generatingMillis: 1_000,
    toolWaitMillis: 0,
    idleMillis: 2_000,
    unaccountedMillis: 3_000,
  });
});

test.failing("gives tools precedence over providers and unions overlapping tools", () => {
  const timeline = new RuntimeTimeline();
  timeline.startSession(0);
  timeline.startProcessing(0);
  timeline.startProvider(0);
  timeline.startTool("one", 2_000);
  timeline.startTool("two", 3_000);
  timeline.endTool("one", 4_000);
  timeline.endTool("two", 5_000);
  timeline.endProvider(6_000);
  timeline.settle(6_000);
  expect(timeline.snapshot(6_000)).toEqual({
    wallMillis: 6_000,
    generatingMillis: 3_000,
    toolWaitMillis: 3_000,
    idleMillis: 0,
    unaccountedMillis: 0,
  });
});

test.failing("reattributes reported subagents across all four categories", () => {
  const timeline = new RuntimeTimeline();
  timeline.startSession(0);
  timeline.startProcessing(0);
  timeline.startTool("child", 0);
  timeline.endTool("child", 12);
  timeline.attachSubagentReport("child", {
    version: 2,
    observedMillis: 10,
    generatingMillis: 4,
    toolWaitMillis: 3,
    idleMillis: 2,
    unaccountedMillis: 1,
  });
  timeline.settle(12);
  expect(timeline.snapshot(12)).toEqual({
    wallMillis: 12,
    generatingMillis: 4,
    toolWaitMillis: 5,
    idleMillis: 2,
    unaccountedMillis: 1,
  });
});
```

Also port the existing overlap tests to `RuntimeTimeline`, retaining the start-order subagent ownership assertion and missing-report-as-tool assertion.

- [ ] **Step 2: Verify RED is safely expected**

Run:

```bash
bun test tests/runtime-status.test.ts
```

Expected: exit 0; new timeline cases pass only because they are marked `test.failing`; all existing tests remain green.

- [ ] **Step 3: Commit the Track A timeline contract**

```bash
git add dot_pi/agent/runtime-status-core.ts tests/runtime-status.test.ts
git commit -m "test: specify exclusive session timeline"
```

- [ ] **Step 4: Implement interval storage and exclusive projection**

Use private interval records:

```ts
type Interval = { startedAt: number; endedAt: number | null };
type ToolInterval = Interval & {
  toolCallId: string;
  sequence: number;
  subagentReport: RuntimeStatusReport | null;
};
```

`RuntimeTimeline` owns one session interval, an array plus optional open processing interval, an array plus optional open provider interval, a tool map, and a sequence counter. Starts before session start are ignored; duplicate starts for an open processing/provider/tool interval are ignored; unmatched ends are ignored; ends are clamped to at least their start. `shutdown(now)` closes the session boundary but leaves every still-open child interval effectively ending at the same shutdown time. `reset()` clears every field and resets sequence.

Implement `snapshot(now)` as this exact sweep:

1. Clamp the effective end to `sessionEndedAt ?? now`, never before session start.
2. Add session start/end and every intersecting processing, provider, and tool start/effective-end to a sorted boundary set.
3. For each positive segment, test coverage at `segmentStart`.
4. If no processing interval covers it, add duration to idle.
5. Otherwise choose the earliest-sequence covering tool that has a valid child report. If found, add duration to that child's `ownedDuration`.
6. Otherwise, if any tool covers it, add duration to tool wait.
7. Otherwise, if any provider interval covers it, add duration to generation.
8. Otherwise add duration to unaccounted.
9. For each reported child owner, calculate `attributable = round(owned * min(1, report.observedMillis / parentToolDuration))`, add `scaleReport(report, attributable)` category-by-category, and add `owned - attributable` to tool wait.
10. Return `wallMillis = effectiveEnd - sessionStartedAt` and assert by construction that the four categories sum to it.

Retain `ToolIntervalLedger` temporarily because the deployed extension and adapter still consume it at this checkpoint. Task 3 ports those consumers and deletes the old class so the final design has only one accounting implementation. Remove `.failing` from all new `RuntimeTimeline` tests.

- [ ] **Step 5: Run timeline tests GREEN**

Run:

```bash
bun test tests/runtime-status.test.ts
```

Expected: all strict report, overlap, scaling, and timeline tests pass.

- [ ] **Step 6: Commit the Track B timeline implementation**

```bash
git add dot_pi/agent/runtime-status-core.ts tests/runtime-status.test.ts
git commit -m "feat: add exclusive session runtime timeline"
```

---

### Task 3: Wire Pi lifecycle and render the stopwatch

**Files:**
- Modify: `dot_pi/agent/exact_extensions/runtime-status.ts:1-end`
- Test: `tests/runtime-status.test.ts:300-end`

**Interfaces:**
- Consumes: `RuntimeTimeline`, `RuntimeDistribution`, `SubagentReportSink`, and strict report v2 from Tasks 1–2.
- Produces: `recordSessionStart`, `recordProcessingStart`, `recordAgentSettled`, `recordSessionShutdown`, `distributionSnapshot`, `formatStopwatch`, and `formatStatus` pure helpers.
- Changes: `createSubagentTelemetryAdapter(...).attachReportIfPresent` accepts `SubagentReportSink` rather than the removed `ToolIntervalLedger`.

- [ ] **Step 1: Add extension contract stubs and expected-failure lifecycle/rendering tests**

Export compilation-only contract stubs before adding tests:

```ts
export function recordSessionStart(_state: RuntimeStatusState, _now: number): void {}
export function recordProcessingStart(_state: RuntimeStatusState, _now: number): void {}
export function recordAgentSettled(_state: RuntimeStatusState, _now: number): void {}
export function recordSessionShutdown(_state: RuntimeStatusState, _now: number): void {}
export function formatStopwatch(_millis: number): string { return ""; }
```

These stubs contain no accounting behavior; the real assertions below remain expected failures. Replace old residual-idle expectations with explicit session tests:

```ts
test.failing("keeps whole-session settled time idle and active gaps other", () => {
  const state = createRuntimeStatusState();
  recordSessionStart(state, 0);
  recordProcessingStart(state, 1_000);
  recordTurnStart(state, 2_000);
  handleAssistantMessageEnd(state, 3_000, 100);
  recordAgentEnd(state, 4_000);
  recordAgentSettled(state, 5_000);

  expect(distributionSnapshot(state, 10_000)).toEqual({
    wallMillis: 10_000,
    generatingMillis: 1_000,
    toolWaitMillis: 0,
    idleMillis: 6_000,
    unaccountedMillis: 3_000,
  });
});

test.failing("formats compact session stopwatch boundaries", () => {
  expect(formatStopwatch(8_999)).toBe("8s");
  expect(formatStopwatch(134_999)).toBe("2m 14s");
  expect(formatStopwatch(3_792_999)).toBe("1h 03m 12s");
});

test.failing("renders stopwatch and explicit other percentage", () => {
  const state = createRuntimeStatusState();
  recordSessionStart(state, 0);
  recordProcessingStart(state, 1_000);
  recordTurnStart(state, 2_000);
  handleAssistantMessageEnd(state, 3_000, 100);
  recordAgentSettled(state, 5_000);

  expect(formatStatus(state, 10_000)).toBe(
    "⏱ 10s | 100.0 t/s | gen 1.0s 10% | tools 0.0s 0% | idle 6.0s 60% | other 3.0s 30%",
  );
});
```

Update the adapter test to construct `RuntimeTimeline`, start a session and processing envelope, start/end the matching tool, attach the v2 report, and assert the four-category snapshot. Keep TPS tests asserting provider duration remains the denominator.

- [ ] **Step 2: Run extension tests and verify anticipated failures**

Run:

```bash
bun test tests/runtime-status.test.ts
```

Expected: exit 0; new lifecycle/format cases are expected failures and report/schema/timeline tests pass normally.

- [ ] **Step 3: Commit the Track A extension contract**

```bash
git add dot_pi/agent/exact_extensions/runtime-status.ts tests/runtime-status.test.ts
git commit -m "test: specify session stopwatch lifecycle"
```

- [ ] **Step 4: Replace residual state with the timeline and lifecycle helpers**

Make `RuntimeStatusState` own a `timeline: RuntimeTimeline` and a single
`currentProviderStartedAt: number | null` for the independent TPS denominator.
Remove the obsolete `TimeDistribution`, `recordToolExecutionStart/End` single
interval counters, `observedRuntimeMillis`, and residual-idle helpers.

Implement these transitions:

```ts
export function recordSessionStart(state: RuntimeStatusState, now: number): void {
  resetSession(state);
  state.timeline.startSession(now);
}

export function recordProcessingStart(state: RuntimeStatusState, now: number): void {
  state.timeline.startProcessing(now);
}

export function recordTurnStart(state: RuntimeStatusState, now: number): void {
  if (state.currentProviderStartedAt === null) state.currentProviderStartedAt = now;
  state.timeline.startProvider(now);
}

export function recordAgentSettled(state: RuntimeStatusState, now: number): void {
  closeCurrentTurnGeneration(state, now);
  state.timeline.endProvider(now);
  state.timeline.settle(now);
}

export function recordSessionShutdown(state: RuntimeStatusState, now: number): void {
  closeCurrentTurnGeneration(state, now);
  state.timeline.endProvider(now);
  state.timeline.shutdown(now);
}

export function distributionSnapshot(
  state: RuntimeStatusState,
  now: number,
): RuntimeDistribution {
  return state.timeline.snapshot(now);
}
```

`handleAssistantMessageEnd` closes both the TPS provider timer and timeline
provider interval. `recordAgentEnd` closes an unexpectedly open provider but
does not settle processing or stop session timing. Tool lifecycle helpers call
`state.timeline.startTool/endTool`.

Remove `.failing` from lifecycle tests once these helpers pass.

- [ ] **Step 5: Implement stopwatch/status formatting**

Use floor-to-completed-second stopwatch formatting:

```ts
export function formatStopwatch(millis: number): string {
  const totalSeconds = Math.floor(Math.max(0, millis) / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
  }
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}
```

`formatStatus(state, now)` must use `snapshot.wallMillis` for the stopwatch and every percentage denominator, retain one-decimal seconds for categories, label `unaccountedMillis` as `other`, and produce the exact tested field order. Remove the old streaming/checkmark icon because the approved stopwatch occupies the leading status position.

- [ ] **Step 6: Wire the complete Pi session lifecycle**

Change event handlers as follows:

- `session_start`: call `recordSessionStart(state, now)`, start the render interval, and immediately set status instead of clearing it.
- `before_agent_start`: call `recordProcessingStart(state, now)` and refresh status.
- `turn_start`: open provider/TPS timing.
- tool start/end: update `state.timeline`; attach a child report to that same timeline after tool end.
- `agent_end`: defensively close provider timing and refresh only; do not stop the interval.
- `agent_settled`: call `recordAgentSettled` and refresh; do not stop the interval.
- `session_shutdown`: capture one `now`, call `recordSessionShutdown`, stop the interval, clean pending reports, publish strict v2 from the final snapshot, then clear status.

The published report is:

```ts
const report: RuntimeStatusReport = {
  version: 2,
  observedMillis: distribution.wallMillis,
  generatingMillis: distribution.generatingMillis,
  toolWaitMillis: distribution.toolWaitMillis,
  idleMillis: distribution.idleMillis,
  unaccountedMillis: distribution.unaccountedMillis,
};
```

Change the adapter sink parameter to `SubagentReportSink`, preserving its fake-store boundary and cleanup behavior. Port the remaining adapter and reconciliation tests from `ToolIntervalLedger` to `RuntimeTimeline`, then delete `ToolIntervalLedger` and its old imports so only the unified timeline remains.

- [ ] **Step 7: Run the complete automated suite**

Run:

```bash
bun test tests/runtime-status.test.ts tests/pi-subagent.test.ts
```

Expected: all tests pass, no `test.failing` cases remain, and no network/UI/system behavior runs.

- [ ] **Step 8: Commit the Track B lifecycle implementation**

```bash
git add dot_pi/agent/exact_extensions/runtime-status.ts tests/runtime-status.test.ts
git commit -m "feat: report explicit session walltime"
```

---

### Task 4: Manual QA contract and deployment verification

**Files:**
- Modify: `docs/qa/runtime-status-subagent-telemetry.md`
- Apply target: `~/.pi/agent/extensions/runtime-status.ts` via chezmoi (do not edit directly)

**Interfaces:**
- Consumes: final v2 status and lifecycle behavior from Task 3.
- Produces: a manual-only QA procedure; no automated test or hook changes.

- [ ] **Step 1: Update the manual QA observations**

Change the expected root status total from three categories to:

```text
generation + tool wait + idle + other = stopwatch walltime
```

Add these manual checks:

1. Leave Pi waiting at the editor for at least five seconds; the stopwatch and idle duration increase while `other` does not.
2. Submit a normal prompt; processing gaps not covered by provider/tool intervals appear under `other`, not idle.
3. Run the existing direct and nested `pi-subagent` prompts; child generation/tool/idle/other replace only attributable Bash tool time.
4. Confirm no report JSON or `PI_RUNTIME_STATUS_REPORT_PATH` enters shell output or conversation context.
5. Confirm all categories remain bounded by and sum to the displayed stopwatch, allowing only display-rounding differences.

Keep the document's explicit prohibition against CI, hooks, and Bun test inclusion.

- [ ] **Step 2: Verify source state before applying**

Run:

```bash
git diff --check
bun test tests/runtime-status.test.ts tests/pi-subagent.test.ts
chezmoi diff
```

Expected: no whitespace errors; all Bun tests pass; `chezmoi diff` shows only the intended runtime-status deployment change (plus any pre-existing user changes, which must be reported rather than overwritten).

- [ ] **Step 3: Apply the source-state extension**

Run:

```bash
chezmoi apply
```

Expected: the managed runtime-status extension is synchronized under `~/.pi/agent/` without errors.

- [ ] **Step 4: Record the QA documentation commit**

```bash
git add docs/qa/runtime-status-subagent-telemetry.md
git commit -m "docs: update runtime walltime QA"
```

- [ ] **Step 5: Request user-assisted interactive QA**

Because this QA requires observing Pi's TUI and provider-backed subagents, do not automate it. Present the updated procedure and ask the user to run or supervise it. Record any discrepancy as a reproducible non-UI unit test before changing accounting logic.

- [ ] **Step 6: Final verification**

Run:

```bash
git status --short
bun test tests/runtime-status.test.ts tests/pi-subagent.test.ts
```

Expected: clean tracked working tree and all tests pass. If chezmoi reports unrelated pre-existing target drift, report it explicitly without modifying unrelated files.
