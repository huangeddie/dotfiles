# Runtime Status Unified Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove file-operation timing and classify every ordinary Pi tool execution under the single `tools` distribution.

**Architecture:** Simplify the pure timeline and strict v2 telemetry schema from five atomic categories to model, tool wait, idle, and unaccounted. The Pi adapter forwards tool intervals without name classification; reported subagents still replace only attributable parent tool time with their recursive distribution.

**Tech Stack:** TypeScript, Pi extension events, Bun 1.3 tests, Node filesystem APIs, chezmoi source state.

## Global Constraints

- `wallMillis = modelMillis + toolWaitMillis + idleMillis + unaccountedMillis` for every snapshot.
- Every ordinary root tool, including `read`, `write`, `edit`, and Bash, is tool wait.
- Exclusive precedence is reported subagent, ordinary tool, provider model time, then unaccounted; outside active processing is idle.
- Recursive telemetry supports only strict report `version: 2`; no compatibility with the superseded five-category v2 shape.
- Child report and filesystem failures remain private, best-effort, and non-fatal.
- TPS uses only provider/model duration.
- Unit tests use explicit timestamps and practical fakes; no real clocks, timers, filesystem, network, UI, or sampling.
- Manual QA stays outside Bun, hooks, and CI.
- Chezmoi deployment must target only `~/.pi/agent/extensions/runtime-status.ts` so unrelated target drift is not overwritten.
- Use Bun `test.failing` for RED contracts and separate Conventional Commits for Track A and Track B.

---

### Task 1: Unify runtime tool accounting

**Files:**
- Modify: `dot_pi/agent/runtime-status-core.ts`
- Modify: `dot_pi/agent/exact_extensions/runtime-status.ts`
- Test: `tests/runtime-status.test.ts`

**Interfaces:**
- Produces strict `RuntimeStatusReport` and `RuntimeDistribution` without `fileOpsMillis`.
- Changes `RuntimeTimeline.startTool(toolCallId: string, now: number): void`.
- Removes `RootToolClassification` and `classifyRootTool`.
- Preserves report-store, subagent adapter, stopwatch, lifecycle, and TPS interfaces.

- [ ] **Step 1: Write RED expected-failure contracts**

Change type shells to:

```ts
export type RuntimeStatusReport = {
  version: 2;
  observedMillis: number;
  modelMillis: number;
  toolWaitMillis: number;
  idleMillis: number;
  unaccountedMillis: number;
};

export type RuntimeCategoryMillis = Pick<
  RuntimeStatusReport,
  "modelMillis" | "toolWaitMillis" | "idleMillis" | "unaccountedMillis"
>;

export type RuntimeDistribution = RuntimeCategoryMillis & {
  wallMillis: number;
};
```

Add compilation stubs as needed and mark affected assertions with `test.failing`. Required real assertions:

```ts
test.failing("accepts strict four-category v2 reports", () => {
  const valid: RuntimeStatusReport = {
    version: 2,
    observedMillis: 10,
    modelMillis: 4,
    toolWaitMillis: 3,
    idleMillis: 2,
    unaccountedMillis: 1,
  };
  expect(validateRuntimeStatusReport(valid)).toEqual(valid);
  expect(validateRuntimeStatusReport({ ...valid, fileOpsMillis: 0 })).toBeNull();
  expect(validateRuntimeStatusReport({ ...valid, observedMillis: 11 })).toBeNull();
});

test.failing("scales all four categories with total-preserving rounding", () => {
  expect(scaleReport({
    version: 2,
    observedMillis: 4,
    modelMillis: 1,
    toolWaitMillis: 1,
    idleMillis: 1,
    unaccountedMillis: 1,
  }, 10)).toEqual({
    modelMillis: 3,
    toolWaitMillis: 3,
    idleMillis: 2,
    unaccountedMillis: 2,
  });
});

test.failing("classifies read write and edit execution as ordinary tool time", () => {
  const timeline = new RuntimeTimeline();
  timeline.startSession(0);
  timeline.startProcessing(0);
  timeline.startTool("read", 1_000);
  timeline.endTool("read", 2_000);
  timeline.startTool("write", 2_000);
  timeline.endTool("write", 3_000);
  timeline.startTool("edit", 3_000);
  timeline.endTool("edit", 4_000);
  timeline.settle(4_000);
  expect(timeline.snapshot(4_000)).toEqual({
    wallMillis: 4_000,
    modelMillis: 0,
    toolWaitMillis: 3_000,
    idleMillis: 0,
    unaccountedMillis: 1_000,
  });
});

test.failing("renders one tools category without files", () => {
  const state = createRuntimeStatusState();
  recordSessionStart(state, 0);
  recordProcessingStart(state, 0);
  recordToolExecutionStart(state, "read", 1_000);
  recordToolExecutionEnd(state, "read", 2_000);
  recordAgentSettled(state, 2_000);
  expect(formatStatus(state, 2_000)).toBe(
    "⏱ 2s | 0.0 t/s | gen 0.0s 0% | tools 1.0s 50% | idle 0.0s 0% | other 1.0s 50%",
  );
});
```

Update report fixtures to remove `fileOpsMillis`; update tool starts to the two-argument core signature and extension helper to `recordToolExecutionStart(state, toolCallId, now)`.

- [ ] **Step 2: Verify RED safely**

Run:

```bash
bun test tests/runtime-status.test.ts
```

Expected: exit 0 with changed contracts passing only under `test.failing`; unrelated tests remain ordinary and green.

- [ ] **Step 3: Commit Track A**

```bash
git add dot_pi/agent/runtime-status-core.ts dot_pi/agent/exact_extensions/runtime-status.ts tests/runtime-status.test.ts
git commit -m "test: specify unified runtime tool accounting"
```

- [ ] **Step 4: Implement the four-category schema and timeline**

Use this exact category list, reject unknown report keys, and enforce the strict validation sum:

```ts
const categories = [
  "modelMillis",
  "toolWaitMillis",
  "idleMillis",
  "unaccountedMillis",
] as const;

const reportKeys = new Set([
  "version",
  "observedMillis",
  ...categories,
]);
if (Object.keys(candidate).some((key) => !reportKeys.has(key))) return null;

candidate.observedMillis ===
  candidate.modelMillis + candidate.toolWaitMillis +
    candidate.idleMillis + candidate.unaccountedMillis
```

Return four fields from zero scaling and largest-remainder scaling. Remove classification from `ToolInterval` and implement:

```ts
startTool(toolCallId: string, now: number): void {
  if (this.sessionStartedAt === null || this.tools.has(toolCallId)) return;
  this.tools.set(toolCallId, {
    toolCallId,
    sequence: this.sequence++,
    startedAt: now,
    endedAt: null,
    subagentReport: null,
  });
}
```

During the timeline sweep, after reported-child ownership, any covering tool adds the segment to `toolWaitMillis`; provider coverage comes next. Child scaling merges model/tool/idle/unaccounted and puts unattributable wrapper time into tool wait.

Delete `RootToolClassification`, `classification` fields, `fileOpsMillis`, and `classifyRootTool` everywhere. The extension tool-start handler passes only ID and timestamp. Remove `files` from `formatStatus`. Publish the four-category strict v2 report at shutdown.

Remove every `test.failing` marker after assertions pass.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
bun test tests/runtime-status.test.ts tests/pi-subagent.test.ts
rg -n "fileOpsMillis|RootToolClassification|classifyRootTool|test\.failing" dot_pi tests
```

Expected: all 46 tests, adjusted for replacements, pass with zero failures; the residual-symbol scan prints no matches.

- [ ] **Step 6: Commit Track B**

```bash
git add dot_pi/agent/runtime-status-core.ts dot_pi/agent/exact_extensions/runtime-status.ts tests/runtime-status.test.ts
git commit -m "refactor: unify runtime tool distribution"
```

---

### Task 2: Align QA and deploy the extension safely

**Files:**
- Modify: `docs/qa/runtime-status-subagent-telemetry.md`
- Apply target: `~/.pi/agent/extensions/runtime-status.ts`

**Interfaces:**
- Consumes final four-category status and strict v2 report from Task 1.
- Produces manual-only QA instructions with target-scoped chezmoi deployment.

- [ ] **Step 1: Correct the QA contract**

Replace the five-category invariant with:

```text
model generation + tool wait + idle + other = stopwatch walltime
```

Remove the separate `files` observation. State that `read`, `write`, `edit`, Bash, and all other ordinary root tools increase `tools`; generating tool arguments and processing results remain `gen`.

Replace global deployment with drift-safe commands:

```bash
chezmoi diff ~/.pi/agent/extensions/runtime-status.ts
chezmoi apply ~/.pi/agent/extensions/runtime-status.ts
```

Retain direct/nested subagent, privacy, bounded totals, and manual-only requirements.

- [ ] **Step 2: Verify and deploy**

Run:

```bash
git diff --check
bun test tests/runtime-status.test.ts tests/pi-subagent.test.ts
chezmoi diff ~/.pi/agent/extensions/runtime-status.ts
chezmoi apply ~/.pi/agent/extensions/runtime-status.ts
chezmoi diff ~/.pi/agent/extensions/runtime-status.ts
```

Expected: tests pass; the first scoped diff shows only runtime-status changes; apply succeeds; final scoped diff is empty. Do not run global `chezmoi apply`.

- [ ] **Step 3: Commit QA documentation**

```bash
git add docs/qa/runtime-status-subagent-telemetry.md
git commit -m "docs: unify runtime tools QA"
```

- [ ] **Step 4: Final deterministic verification**

Run:

```bash
git status --short
bun test tests/runtime-status.test.ts tests/pi-subagent.test.ts
```

Expected: clean tracked working tree and all tests pass. Interactive Pi/provider QA remains user-assisted and must not be automated.
