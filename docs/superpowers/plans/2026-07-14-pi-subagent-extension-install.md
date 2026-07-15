# Pi Subagent Extension Installation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install Pi's example `subagent` extension with Terra/Luna agent models and remove the legacy Bash-wrapper mechanism and its runtime telemetry.

**Architecture:** Vendor the upstream extension, agent definitions, and workflow templates into chezmoi source state. Keep runtime status responsible only for the root Pi process by deleting the wrapper's report-file transport and simplifying timeline tool accounting to ordinary wall-clock union accounting.

**Tech Stack:** TypeScript Pi extensions, TypeBox, Bun tests, Markdown prompt templates, chezmoi.

## Global Constraints

- `scout` uses `openai-codex/gpt-5.6-luna`.
- `planner`, `reviewer`, and `worker` use `openai-codex/gpt-5.6-terra`.
- The extension is the sole active subagent interface.
- Historical specs and plans remain tracked.
- Remove wrapper-only executable, system instruction, tests, QA, runtime command interception, report-file effects, and child-runtime reattribution.
- Do not perform a network-backed model invocation during verification.
- This vendor/config installation and pure deletion refactor are exceptions to red-green TDD; preserve and run deterministic runtime-status tests.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `dot_pi/agent/exact_extensions/subagent/index.ts` | Register, execute, stream, and render the `subagent` tool. |
| `dot_pi/agent/exact_extensions/subagent/agents.ts` | Discover and parse user/project agent definitions. |
| `dot_pi/agent/agents/*.md` | Define sample agent names, tool capabilities, models, and system prompts. |
| `dot_pi/agent/prompts/*.md` | Define slash-command workflow templates. |
| `dot_pi/agent/runtime-status-core.ts` | Account only root session/provider/tool wall-clock intervals. |
| `dot_pi/agent/exact_extensions/runtime-status.ts` | Adapt Pi lifecycle events to root runtime status UI. |
| `tests/runtime-status.test.ts` | Verify deterministic root runtime accounting and formatting. |

Deleted active wrapper files:

- `dot_local/bin/executable_pi-subagent`
- `dot_pi/agent/APPEND_SYSTEM.md`
- `tests/pi-subagent.test.ts`
- `docs/qa/pi-subagent-model-selection.md`
- `docs/qa/runtime-status-subagent-telemetry.md`

### Task 1: Vendor the extension and requested agent contracts

**Files:**
- Create: `dot_pi/agent/exact_extensions/subagent/index.ts`
- Create: `dot_pi/agent/exact_extensions/subagent/agents.ts`
- Create: `dot_pi/agent/agents/{planner,reviewer,scout,worker}.md`
- Create: `dot_pi/agent/prompts/{implement-and-review,implement,scout-and-plan}.md`

**Interfaces:**
- Consumes: the upstream example installed with `@earendil-works/pi-coding-agent`.
- Produces: one registered `subagent` tool; global agent Markdown contracts; three prompt-template commands.

- [ ] **Step 1: Copy the upstream example into chezmoi source state**

```bash
upstream=/home/eddie/.npm/_npx/99fca8174466655b/node_modules/@earendil-works/pi-coding-agent/examples/extensions/subagent
mkdir -p dot_pi/agent/exact_extensions/subagent dot_pi/agent/agents dot_pi/agent/prompts
cp "$upstream/index.ts" "$upstream/agents.ts" dot_pi/agent/exact_extensions/subagent/
cp "$upstream"/agents/*.md dot_pi/agent/agents/
cp "$upstream"/prompts/*.md dot_pi/agent/prompts/
```

Expected: the nine upstream files exist in source state with byte-identical content.

- [ ] **Step 2: Replace sample model selectors in agent frontmatter**

Apply these exact mappings:

```yaml
# dot_pi/agent/agents/scout.md
model: openai-codex/gpt-5.6-luna

# planner.md, reviewer.md, worker.md
model: openai-codex/gpt-5.6-terra
```

Expected command and output:

```bash
rg -n '^model:' dot_pi/agent/agents
```

```text
dot_pi/agent/agents/planner.md:model: openai-codex/gpt-5.6-terra
dot_pi/agent/agents/reviewer.md:model: openai-codex/gpt-5.6-terra
dot_pi/agent/agents/scout.md:model: openai-codex/gpt-5.6-luna
dot_pi/agent/agents/worker.md:model: openai-codex/gpt-5.6-terra
```

- [ ] **Step 3: Verify both selectors against Pi's live model catalog**

```bash
pi --list-models gpt-5.6 | grep -E 'gpt-5\.6-(terra|luna)'
```

Expected: rows for `openai-codex gpt-5.6-luna` and `openai-codex gpt-5.6-terra`.

### Task 2: Remove wrapper-owned contracts and effects

**Files:**
- Delete: `dot_local/bin/executable_pi-subagent`
- Delete: `dot_pi/agent/APPEND_SYSTEM.md`
- Delete: `tests/pi-subagent.test.ts`
- Delete: `docs/qa/pi-subagent-model-selection.md`
- Delete: `docs/qa/runtime-status-subagent-telemetry.md`
- Modify: `dot_pi/agent/runtime-status-core.ts`
- Modify: `dot_pi/agent/exact_extensions/runtime-status.ts`
- Modify: `tests/runtime-status.test.ts`

**Interfaces:**
- Removes: `RuntimeStatusReport`, `SubagentReportSink`, `ReportStore`, `validateRuntimeStatusReport`, `scaleReport`, `publishChildReport`, `createSubagentTelemetryAdapter`, `isPiSubagentCommand`, `prepareSubagentCommand`, `FileOperations`, `NodeReportStore`, and `isManagedReportPath`.
- Preserves: `RuntimeDistribution`, `RuntimeTimeline`, runtime lifecycle recorders, status formatting, and ordinary tool-wall-time accounting.

- [ ] **Step 1: Delete wrapper-owned files**

```bash
rm \
  dot_local/bin/executable_pi-subagent \
  dot_pi/agent/APPEND_SYSTEM.md \
  tests/pi-subagent.test.ts \
  docs/qa/pi-subagent-model-selection.md \
  docs/qa/runtime-status-subagent-telemetry.md
```

Expected: `git status --short` marks exactly these tracked files deleted, alongside Task 1 additions and planned runtime modifications.

- [ ] **Step 2: Simplify the runtime core schema and timeline**

In `dot_pi/agent/runtime-status-core.ts`, replace report-derived types with the direct root distribution contract:

```ts
export type RuntimeDistribution = {
  wallMillis: number;
  modelMillis: number;
  toolWaitMillis: number;
  idleMillis: number;
  unaccountedMillis: number;
};

type RuntimeCategoryMillis = Omit<RuntimeDistribution, "wallMillis">;
type Interval = { startedAt: number; endedAt: number | null };
```

Make `RuntimeTimeline.tools` a `Map<string, Interval>`, remove `sequence`, remove `attachSubagentReport`, and create tool intervals as:

```ts
this.tools.set(toolCallId, { startedAt: now, endedAt: null });
```

In each snapshot segment, replace child ownership/reattribution with this priority order:

```ts
if (toolIntervals.some((interval) =>
  this.isCoveredBy([interval], segmentStartedAt, effectiveEnd)
)) {
  totals.toolWaitMillis += duration;
} else if (this.isCoveredBy(this.providerIntervals, segmentStartedAt, effectiveEnd)) {
  totals.modelMillis += duration;
} else {
  totals.unaccountedMillis += duration;
}
```

Delete all report validation, scaling, publishing, owned-duration, and child-report code.

- [ ] **Step 3: Remove report-file effects from the runtime extension**

In `dot_pi/agent/exact_extensions/runtime-status.ts`:

- remove all `node:fs/promises`, `node:os`, and `node:path` imports;
- import only `RuntimeDistribution` and `RuntimeTimeline` from `runtime-status-core`;
- delete all adapter, report-store, command-detection, path-validation, and report-publication declarations;
- remove `store` and `adapter` construction;
- remove the `tool_call` handler that mutates Bash commands;
- make `tool_execution_end` only call `recordToolExecutionEnd`;
- make `session_shutdown` stop the interval and clear UI status without cleanup or report publication:

```ts
pi.on("session_shutdown", async (_event, ctx) => {
  recordSessionShutdown(state, Date.now());
  stopInterval();
  if (ctx.hasUI) {
    ctx.ui.setStatus(STATUS_KEY, undefined);
  }
});
```

- [ ] **Step 4: Remove wrapper telemetry tests while preserving root accounting tests**

In `tests/runtime-status.test.ts`:

- reduce extension imports to the runtime state/recording/formatting exports still present;
- import only `RuntimeTimeline` from `runtime-status-core`;
- delete `FakeReportStore`, `FakeFileOperations`, report validation/scaling/publishing tests, child reattribution tests, command detection tests, managed path/store tests, and telemetry adapter tests;
- retain ordinary overlapping-tool, lifecycle, formatting, TPS, stopwatch, and root distribution tests;
- rename `caps open child intervals at shutdown` to `caps open tool intervals at shutdown`.

- [ ] **Step 5: Run focused verification**

```bash
bun test tests/runtime-status.test.ts
```

Expected: all remaining runtime-status tests pass with zero failures.

### Task 3: Deploy and verify the migration

**Files:**
- Deploys source files from Tasks 1 and 2 to `$HOME` through chezmoi.

**Interfaces:**
- Consumes: clean source-state implementation and Pi's extension discovery.
- Produces: deployed extension/agents/prompts with no legacy wrapper or appended instruction.

- [ ] **Step 1: Inspect source and deployment diffs**

```bash
git diff --check
git diff --stat
chezmoi status
chezmoi diff
```

Expected: no whitespace errors; chezmoi reports only the added Pi extension/agents/prompts, removed wrapper/system prompt, and runtime-status deployment changes.

- [ ] **Step 2: Run the complete deterministic test suite**

```bash
bun test
```

Expected: all repository tests pass with zero failures.

- [ ] **Step 3: Apply chezmoi source state**

```bash
chezmoi apply
```

Expected: successful exit with no error output.

- [ ] **Step 4: Verify deployed contracts and removals**

```bash
test -f ~/.pi/agent/extensions/subagent/index.ts
test -f ~/.pi/agent/extensions/subagent/agents.ts
rg -n '^model:' ~/.pi/agent/agents
! test -e ~/.local/bin/pi-subagent
! test -e ~/.pi/agent/APPEND_SYSTEM.md
! rg -n 'pi-subagent' ~/.pi/agent 2>/dev/null
```

Expected: extension files exist; model mappings match Task 1; wrapper and appended system prompt are absent; no deployed Pi configuration instructs Bash-wrapper use.

- [ ] **Step 5: Smoke-test Pi extension loading without a model request**

```bash
stderr_file="$(mktemp)"
pi --list-models gpt-5.6 >/dev/null 2>"$stderr_file"
test ! -s "$stderr_file"
rm "$stderr_file"
```

Expected: Pi loads configuration and lists models with empty stderr.

- [ ] **Step 6: Commit the atomic migration**

```bash
git add \
  dot_pi/agent/exact_extensions/subagent \
  dot_pi/agent/agents \
  dot_pi/agent/prompts \
  dot_pi/agent/runtime-status-core.ts \
  dot_pi/agent/exact_extensions/runtime-status.ts \
  tests/runtime-status.test.ts \
  dot_local/bin/executable_pi-subagent \
  dot_pi/agent/APPEND_SYSTEM.md \
  tests/pi-subagent.test.ts \
  docs/qa/pi-subagent-model-selection.md \
  docs/qa/runtime-status-subagent-telemetry.md
git commit -m "feat(pi): replace bash subagents with extension"
```

The migration is one atomic pure-removal/vendor/config commit: splitting test/contract deletion from implementation deletion would leave an intermediate commit with stale imports or tests for an intentionally removed interface.

## Plan Self-Review

- **Spec coverage:** Tasks cover vendoring, all four model mappings, wrapper/system-prompt removal, active test/QA cleanup, runtime telemetry removal, deployment, and non-network verification. Historical plans/specs are untouched.
- **Placeholder scan:** Every code-changing step names exact declarations or replacement code; no deferred implementation markers remain.
- **Type consistency:** `RuntimeDistribution` preserves the existing five numeric fields consumed by runtime status. All removed report interfaces are removed from production and tests together.
