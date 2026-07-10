import { describe, expect, test } from "bun:test";

import {
  createRuntimeStatusState,
  distributionSnapshot,
  formatStatus,
  handleAssistantMessageEnd,
  recordAfterProviderResponse,
  recordAgentEnd,
  recordAgentStart,
  recordTurnStart,
  recordToolExecutionEnd,
  recordToolExecutionStart,
} from "../dot_pi/agent/exact_extensions/runtime-status";

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

describe("runtime status contracts", () => {
  test("TPS uses total output tokens over completed model-call time", () => {
    const state = createRuntimeStatusState();

    recordAgentStart(state, 0);
    recordTurnStart(state, 1_000);
    recordAfterProviderResponse(state, 2_000);
    handleAssistantMessageEnd(state, 12_000, 352);
    recordAgentEnd(state, 12_500);

    expect(state.sessionAccumulation).toEqual({ tokens: 352, activeMillis: 11_000 });
    expect(distributionSnapshot(state, 12_500)).toMatchObject({
      generatingMillis: 11_000,
      toolWaitMillis: 0,
      idleMillis: 1_500,
    });
    expect(formatStatus(state, false, 12_500)).toBe(
      "✓ 32.0 t/s | gen 11.0s 88% | tools 0.0s 0% | idle 1.5s 12%",
    );
  });

  test("tool execution counts as tool time outside provider response time", () => {
    const state = createRuntimeStatusState();

    recordAgentStart(state, 0);
    recordTurnStart(state, 1_000);
    recordAfterProviderResponse(state, 1_200);
    handleAssistantMessageEnd(state, 2_000, 100);
    recordToolExecutionStart(state, 2_000);
    recordToolExecutionEnd(state, 5_000);
    recordAgentEnd(state, 5_000);

    expect(distributionSnapshot(state, 5_000)).toMatchObject({
      generatingMillis: 1_000,
      toolWaitMillis: 3_000,
      idleMillis: 1_000,
    });
    expect(formatStatus(state, false, 5_000)).toBe(
      "✓ 100.0 t/s | gen 1.0s 20% | tools 3.0s 60% | idle 1.0s 20%",
    );
  });

  test("multiple turns aggregate tokens over total provider response time", () => {
    const state = createRuntimeStatusState();

    recordAgentStart(state, 0);
    recordTurnStart(state, 1_000);
    recordAfterProviderResponse(state, 1_200);
    handleAssistantMessageEnd(state, 2_000, 100);
    recordToolExecutionStart(state, 2_000);
    recordToolExecutionEnd(state, 5_000);
    recordTurnStart(state, 6_000);
    recordAfterProviderResponse(state, 6_100);
    handleAssistantMessageEnd(state, 6_500, 150);
    recordAgentEnd(state, 6_500);

    expect(distributionSnapshot(state, 6_500)).toMatchObject({
      generatingMillis: 1_500,
      toolWaitMillis: 3_000,
      idleMillis: 2_000,
    });
    expect(formatStatus(state, false, 6_500)).toBe(
      "✓ 166.7 t/s | gen 1.5s 23% | tools 3.0s 46% | idle 2.0s 31%",
    );
  });

  test("runtime totals accumulate across multiple agent runs in one session", () => {
    const state = createRuntimeStatusState();

    recordAgentStart(state, 0);
    recordTurnStart(state, 100);
    recordAfterProviderResponse(state, 200);
    handleAssistantMessageEnd(state, 1_100, 100);
    recordAgentEnd(state, 2_000);

    recordAgentStart(state, 10_000);
    recordTurnStart(state, 10_200);
    recordAfterProviderResponse(state, 10_300);
    handleAssistantMessageEnd(state, 10_700, 150);
    recordAgentEnd(state, 11_000);

    expect(distributionSnapshot(state, 11_000)).toMatchObject({
      generatingMillis: 1_500,
      toolWaitMillis: 0,
      idleMillis: 1_500,
    });
    expect(formatStatus(state, false, 11_000)).toBe(
      "✓ 166.7 t/s | gen 1.5s 50% | tools 0.0s 0% | idle 1.5s 50%",
    );
  });
});
