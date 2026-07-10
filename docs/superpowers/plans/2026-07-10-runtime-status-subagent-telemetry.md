# Runtime Status Subagent Telemetry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reattribute `pi-subagent` subprocess runtime to the root Pi status display through a private, recursive report file while preserving exclusive root wall-clock accounting.

**Architecture:** Extract deterministic accounting, report validation, and interval ownership into `dot_pi/agent/runtime-status-core.ts`. Keep `dot_pi/agent/exact_extensions/runtime-status.ts` as the composition root: it adapts Pi lifecycle events, injects a private report path into recognized `pi-subagent` bash calls, and performs filesystem effects through a narrow report-store interface.

**Tech Stack:** TypeScript, Bun test, Pi extension lifecycle API, Node `fs/promises`, chezmoi exact-directory deployment.

## Global Constraints

- Preserve the `RuntimeStatusReport` v1 schema and exact sum invariant from `docs/superpowers/specs/2026-07-10-runtime-status-subagent-telemetry-design.md`.
- Never place telemetry in stdout, stderr, tool results, session entries, or LLM context.
- If `PI_RUNTIME_STATUS_REPORT_PATH` is absent, malformed, inaccessible, or invalid, retain current behavior and ordinary tool attribution.
- Root category totals must remain equal to observed root elapsed time.
- Allocate overlapping subagents deterministically by `tool_execution_start` order; do not double-count wall time.
- Keep all automated tests fast, deterministic, and filesystem/network-free by using fakes at effect boundaries.
- Do not modify `dot_local/bin/executable_pi-subagent`; environment inheritance is its only telemetry responsibility.
- Bun has `test.todo` but no expected-failure assertion mode. Track-A tests use `test.todo`; implementation activates their real assertions in the paired Track-B commit.

---

## File structure

- Create: `dot_pi/agent/runtime-status-core.ts` — pure schema validation, exact integer allocation, tool-interval ledger, and exclusive distribution projection.
- Modify: `dot_pi/agent/exact_extensions/runtime-status.ts` — Pi event adapter, private report-store implementation, subagent command detection/injection, and child report publication.
- Modify: `tests/runtime-status.test.ts` — Track-A test declarations, then deterministic contract assertions for core accounting and a fake report store.
- Create: `docs/qa/runtime-status-subagent-telemetry.md` — manual, non-CI QA procedure for a real nested `pi-subagent` invocation.

## Task 1: Declare the telemetry contract and verification surface (Track A)

**Files:**
- Create: `dot_pi/agent/runtime-status-core.ts`
- Modify: `tests/runtime-status.test.ts`

**Interfaces:**
- Produces `RuntimeStatusReport`, `validateRuntimeStatusReport(value)`, `scaleReport(report, targetMillis)`, and `ToolIntervalLedger` for later implementation.
- Produces `ReportStore`, owned by the extension adapter, so filesystem access is replaceable by a practical fake.

- [ ] **Step 1: Add compilation-only interface shells to `dot_pi/agent/runtime-status-core.ts`**

```ts
export type RuntimeStatusReport = {
  version: 1;
  observedMillis: number;
  generatingMillis: number;
  toolWaitMillis: number;
  idleMillis: number;
};

export type RuntimeCategoryMillis = Pick<
  RuntimeStatusReport,
  "generatingMillis" | "toolWaitMillis" | "idleMillis"
>;

export type ToolInterval = {
  toolCallId: string;
  sequence: number;
  startedAt: number;
  endedAt: number | null;
  subagentReport: RuntimeStatusReport | null;
};

export type ReportStore = {
  create(): Promise<string>;
  readAndRemove(path: string): Promise<unknown | null>;
  writeAtomically(path: string, report: RuntimeStatusReport): Promise<void>;
  remove(path: string): Promise<void>;
};

export function validateRuntimeStatusReport(_value: unknown): RuntimeStatusReport | null {
  return null;
}

export function scaleReport(_report: RuntimeStatusReport, _targetMillis: number): RuntimeCategoryMillis {
  return { generatingMillis: 0, toolWaitMillis: 0, idleMillis: 0 };
}

export class ToolIntervalLedger {
  start(_toolCallId: string, _startedAt: number): void {}
  end(_toolCallId: string, _endedAt: number): void {}
  attachSubagentReport(_toolCallId: string, _report: RuntimeStatusReport): void {}
  project(_now: number): RuntimeCategoryMillis {
    return { generatingMillis: 0, toolWaitMillis: 0, idleMillis: 0 };
  }
}
```

- [ ] **Step 2: Add the Track-A test declarations to `tests/runtime-status.test.ts`**

```ts
import {
  ToolIntervalLedger,
  scaleReport,
  validateRuntimeStatusReport,
} from "../dot_pi/agent/runtime-status-core";

test.todo("accepts only a v1 report with finite non-negative integer durations that sum exactly");
test.todo("scales report categories with deterministic total-preserving rounding");
test.todo("keeps a missing or invalid subagent report as ordinary tool time");
test.todo("reclassifies a complete subagent interval without changing root elapsed time");
test.todo("gives overlapping subagents start-order ownership without double-counting");
test.todo("counts overlapping ordinary tools as a wall-clock union");
```

- [ ] **Step 3: Run the Track-A suite**

Run: `bun test`

Expected: PASS with the four existing tests passing and six tests reported as todo.

- [ ] **Step 4: Commit Track A**

```bash
git add dot_pi/agent/runtime-status-core.ts tests/runtime-status.test.ts
git commit -m "test: define subagent runtime telemetry contract"
```

## Task 2: Implement pure report validation and exclusive interval accounting (Track B)

**Files:**
- Modify: `dot_pi/agent/runtime-status-core.ts`
- Modify: `tests/runtime-status.test.ts`

**Interfaces:**
- Consumes `RuntimeStatusReport`, `ToolIntervalLedger`, `validateRuntimeStatusReport`, and `scaleReport` from Task 1.
- Produces a complete, deterministic `ToolIntervalLedger.project(now)` implementation whose category sum is the union of all active/completed tool intervals.

- [ ] **Step 1: Replace the first two todo tests with concrete validation and scaling tests**

```ts
test("accepts only a v1 report with finite non-negative integer durations that sum exactly", () => {
  const valid = {
    version: 1,
    observedMillis: 10,
    generatingMillis: 4,
    toolWaitMillis: 3,
    idleMillis: 3,
  };

  expect(validateRuntimeStatusReport(valid)).toEqual(valid);
  expect(validateRuntimeStatusReport({ ...valid, version: 2 })).toBeNull();
  expect(validateRuntimeStatusReport({ ...valid, idleMillis: -1 })).toBeNull();
  expect(validateRuntimeStatusReport({ ...valid, generatingMillis: 4.5 })).toBeNull();
  expect(validateRuntimeStatusReport({ ...valid, observedMillis: 11 })).toBeNull();
});

test("scales report categories with deterministic total-preserving rounding", () => {
  expect(scaleReport({ version: 1, observedMillis: 3, generatingMillis: 1, toolWaitMillis: 1, idleMillis: 1 }, 10))
    .toEqual({ generatingMillis: 4, toolWaitMillis: 3, idleMillis: 3 });
});
```

- [ ] **Step 2: Replace the remaining ledger todo tests with concrete assertions**

```ts
test("keeps a missing or invalid subagent report as ordinary tool time", () => {
  const ledger = new ToolIntervalLedger();
  ledger.start("subagent", 0);
  ledger.end("subagent", 10);
  expect(ledger.project(10)).toEqual({ generatingMillis: 0, toolWaitMillis: 10, idleMillis: 0 });
});

test("reclassifies a complete subagent interval without changing root elapsed time", () => {
  const ledger = new ToolIntervalLedger();
  ledger.start("subagent", 0);
  ledger.end("subagent", 12);
  ledger.attachSubagentReport("subagent", {
    version: 1, observedMillis: 10, generatingMillis: 5, toolWaitMillis: 3, idleMillis: 2,
  });
  expect(ledger.project(12)).toEqual({ generatingMillis: 5, toolWaitMillis: 5, idleMillis: 2 });
});

test("gives overlapping subagents start-order ownership without double-counting", () => {
  const ledger = new ToolIntervalLedger();
  ledger.start("first", 0); ledger.start("second", 5);
  ledger.end("first", 10); ledger.end("second", 15);
  ledger.attachSubagentReport("first", { version: 1, observedMillis: 10, generatingMillis: 10, toolWaitMillis: 0, idleMillis: 0 });
  ledger.attachSubagentReport("second", { version: 1, observedMillis: 10, generatingMillis: 0, toolWaitMillis: 10, idleMillis: 0 });
  expect(ledger.project(15)).toEqual({ generatingMillis: 10, toolWaitMillis: 5, idleMillis: 0 });
});

test("counts overlapping ordinary tools as a wall-clock union", () => {
  const ledger = new ToolIntervalLedger();
  ledger.start("one", 0); ledger.start("two", 5);
  ledger.end("one", 10); ledger.end("two", 15);
  expect(ledger.project(15)).toEqual({ generatingMillis: 0, toolWaitMillis: 15, idleMillis: 0 });
});
```

- [ ] **Step 3: Implement strict validation, largest-remainder scaling, and sweep-line projection**

Implement these rules in `dot_pi/agent/runtime-status-core.ts`:

```ts
const categories = ["generatingMillis", "toolWaitMillis", "idleMillis"] as const;

function isMillis(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

// In ToolIntervalLedger.project(now):
// 1. close open intervals at `now` without mutating them;
// 2. sort unique start/end boundaries;
// 3. for each [start, end) segment choose the active reported subagent with
//    lowest `sequence`; otherwise attribute it to ordinary tool wait;
// 4. give a subagent only its owned interval share, scaled from its aggregate
//    report; leave unreported/excess duration as ordinary tool wait.
```

Use integer largest-remainder allocation with the stable category order above:
compute each quotient/remainder, assign floors, then distribute remaining
milliseconds in descending remainder order and category-order tiebreak order.

- [ ] **Step 4: Run focused and full tests**

Run: `bun test tests/runtime-status.test.ts && bun test`

Expected: all ten tests pass; zero todo tests remain.

- [ ] **Step 5: Commit Track B core implementation**

```bash
git add dot_pi/agent/runtime-status-core.ts tests/runtime-status.test.ts
git commit -m "feat: account for nested subagent runtime"
```

## Task 3: Adapt Pi events and private report-file effects (Track B)

**Files:**
- Modify: `dot_pi/agent/exact_extensions/runtime-status.ts`
- Modify: `tests/runtime-status.test.ts`

**Interfaces:**
- Consumes `ReportStore`, `RuntimeStatusReport`, `ToolIntervalLedger`, and `validateRuntimeStatusReport` from Task 1/2.
- Produces `prepareSubagentCommand(command: string, store: ReportStore): Promise<{ command: string; reportPath: string | null }>` and `isPiSubagentCommand(command: string): boolean`; the latter recognizes only a leading `pi-subagent` executable token.
- Produces transparent `pi-subagent` telemetry propagation with no change to bash output or `pi-subagent` source.

- [ ] **Step 1: Add a fake report store and command-injection tests**

Add this practical fake and tests around extracted adapter helpers:

```ts
class FakeReportStore {
  readonly reports = new Map<string, unknown>();
  readonly removed: string[] = [];
  private next = 0;

  async create(): Promise<string> { return `/tmp/runtime-${this.next++}.json`; }
  async readAndRemove(path: string): Promise<unknown | null> {
    const value = this.reports.get(path) ?? null;
    this.reports.delete(path);
    this.removed.push(path);
    return value;
  }
  async writeAtomically(path: string, report: RuntimeStatusReport): Promise<void> {
    this.reports.set(path, report);
  }
  async remove(path: string): Promise<void> { this.reports.delete(path); this.removed.push(path); }
}

test("injects a private report path only for a pi-subagent bash command", async () => {
  const store = new FakeReportStore();
  const result = await prepareSubagentCommand("pi-subagent 'inspect this'", store);
  expect(result.command).toBe("export PI_RUNTIME_STATUS_REPORT_PATH='/tmp/runtime-0.json'; pi-subagent 'inspect this'");
  expect((await prepareSubagentCommand("git status", store)).command).toBe("git status");
});
```

- [ ] **Step 2: Implement the report store as the only filesystem boundary**

In `runtime-status.ts`, create a `NodeReportStore` using `mkdtemp` to make a
mode-`0o700` `pi-runtime-status-*` directory under `tmpdir()`. Its `create()`
returns that directory's absolute `report.json` path; `writeAtomically()` uses
a sibling temporary file with mode `0o600` and `rename`; reads use `readFile`
and cleanup uses best-effort `rm`.

At read time, the parent accepts only a path from its pending tool-call-ID map,
never from bash output or an arbitrary environment value. At write time, a
child accepts `PI_RUNTIME_STATUS_REPORT_PATH` only when it is an absolute
`report.json` below `tmpdir()` in a `pi-runtime-status-*` directory.

- [ ] **Step 3: Wire Pi lifecycle events to the ledger and report store**

Make the extension composition root perform these exact operations:

```ts
pi.on("tool_call", async (event) => {
  if (event.toolName !== "bash" || !isPiSubagentCommand(event.input.command)) return;
  const prepared = await adapter.prepare(event.toolCallId, event.input.command);
  event.input.command = prepared.command;
});

pi.on("tool_execution_start", (event) => {
  ledger.start(event.toolCallId, Date.now());
});

pi.on("tool_execution_end", async (event) => {
  ledger.end(event.toolCallId, Date.now());
  await adapter.attachReportIfPresent(event.toolCallId, ledger);
});
```

Update `distributionSnapshot` and `formatStatus` using this exact
reconciliation: `generatingMillis = completedRootModelMillis +
ledger.project(now).generatingMillis`; `toolWaitMillis =
ledger.project(now).toolWaitMillis`; `idleMillis = observedRuntimeMillis -
generatingMillis - toolWaitMillis`. The residual is therefore both the
ledger's child-idle allocation and any root idle time, while root model
intervals and observed agent-time accounting remain intact. On
`session_shutdown`, delete all still-pending report paths. When
`process.env.PI_RUNTIME_STATUS_REPORT_PATH` passes the managed-path shape
check, publish the final aggregate `RuntimeStatusReport`; when absent or
invalid, do nothing.

- [ ] **Step 4: Run the unit suite**

Run: `bun test`

Expected: all existing and new deterministic tests pass.

- [ ] **Step 5: Commit the Pi adapter implementation**

```bash
git add dot_pi/agent/exact_extensions/runtime-status.ts tests/runtime-status.test.ts
git commit -m "feat: propagate private subagent telemetry"
```

## Task 4: Add manual QA guidance (Track A)

**Files:**
- Create: `docs/qa/runtime-status-subagent-telemetry.md`

**Interfaces:**
- Consumes the implemented extension and `pi-subagent` wrapper.
- Produces a manual-only QA procedure; it must not be added to `bun test`, hooks, or CI.

- [ ] **Step 1: Write the QA procedure**

Document these commands and expected observations:

```bash
chezmoi apply
cd /tmp
pi
# In Pi: ask it to invoke `pi-subagent "Reply with exactly: child complete"`.
```

Expected: the root status transitions from tool time to child generation/idle
(or child tool) time after the subprocess completes; the assistant receives
only `child complete`; neither the shell output nor conversation transcript
contains `PI_RUNTIME_STATUS_REPORT_PATH` or report JSON.

Add a nested manual check: instruct the child prompt to call `pi-subagent` once
and confirm the root totals remain at or below elapsed wall time.

- [ ] **Step 2: Commit the QA documentation**

```bash
git add docs/qa/runtime-status-subagent-telemetry.md
git commit -m "docs: add subagent telemetry QA procedure"
```

## Final verification

- [ ] Run `bun test` and require zero failures and zero todos.
- [ ] Run `chezmoi diff` and confirm only `~/.pi/agent/runtime-status-core.ts` and `~/.pi/agent/extensions/runtime-status.ts` are deployment changes.
- [ ] Run the Task 4 QA procedure manually; do not add it to automated test commands.
- [ ] Run `git status --short` and confirm the working tree is clean.
