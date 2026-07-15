import { expect, test } from "bun:test";

import {
  createRuntimeStatusState,
  distributionSnapshot,
  formatStatus,
  formatStopwatch,
  handleAssistantMessageEnd,
  recordAgentEnd,
  recordAgentSettled,
  recordProcessingStart,
  recordSessionStart,
  recordTurnStart,
  recordToolExecutionEnd,
  recordToolExecutionStart,
} from "../dot_pi/agent/exact_extensions/runtime-status";

import { RuntimeTimeline } from "../dot_pi/agent/runtime-status-core";

test("partitions settled and uncovered active session walltime", () => {
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
    modelMillis: 1_000,
    toolWaitMillis: 1_000,
    idleMillis: 4_000,
    unaccountedMillis: 2_000,
  });
});

test("keeps agent-end retry gaps active until agent_settled", () => {
  const timeline = new RuntimeTimeline();
  timeline.startSession(0);
  timeline.startProcessing(1_000);
  // A low-level agent_end produces no timeline transition.
  timeline.startProvider(2_000);
  timeline.endProvider(3_000);
  timeline.settle(5_000);
  expect(timeline.snapshot(6_000)).toEqual({
    wallMillis: 6_000,
    modelMillis: 1_000,
    toolWaitMillis: 0,
    idleMillis: 2_000,
    unaccountedMillis: 3_000,
  });
});

test("applies tool wait before provider coverage", () => {
  const timeline = new RuntimeTimeline();
  timeline.startSession(0);
  timeline.startProcessing(0);
  timeline.startProvider(0);
  timeline.startTool("read", 1_000);
  timeline.startTool("bash", 2_000);
  timeline.endTool("bash", 3_000);
  timeline.endTool("read", 4_000);
  timeline.endProvider(6_000);
  timeline.settle(6_000);
  expect(timeline.snapshot(6_000)).toEqual({
    wallMillis: 6_000,
    modelMillis: 3_000,
    toolWaitMillis: 3_000,
    idleMillis: 0,
    unaccountedMillis: 0,
  });
});

test("counts overlapping ordinary tools as a wall-clock union", () => {
  const timeline = new RuntimeTimeline();
  timeline.startSession(0);
  timeline.startProcessing(0);
  timeline.startTool("one", 0);
  timeline.startTool("two", 5);
  timeline.endTool("one", 10);
  timeline.endTool("two", 15);
  timeline.settle(15);
  expect(timeline.snapshot(15)).toEqual({
    wallMillis: 15,
    modelMillis: 0,
    toolWaitMillis: 15,
    idleMillis: 0,
    unaccountedMillis: 0,
  });
});

test("ignores pre-session starts and unmatched ends", () => {
  const timeline = new RuntimeTimeline();
  timeline.endProvider(0);
  timeline.endTool("unknown", 0);
  timeline.startProcessing(0);
  timeline.startProvider(0);
  timeline.startTool("before", 0);
  timeline.startSession(10);
  timeline.startProcessing(10);
  timeline.settle(20);

  expect(timeline.snapshot(20)).toEqual({
    wallMillis: 10,
    modelMillis: 0,
    toolWaitMillis: 0,
    idleMillis: 0,
    unaccountedMillis: 10,
  });
});

test("ignores duplicate open interval starts", () => {
  const timeline = new RuntimeTimeline();
  timeline.startSession(0);
  timeline.startProcessing(0);
  timeline.startProvider(0);
  timeline.startTool("tool", 0);
  timeline.startProcessing(1);
  timeline.startProvider(1);
  timeline.startTool("tool", 1);
  timeline.endProvider(5);
  timeline.endTool("tool", 5);
  timeline.settle(5);

  expect(timeline.snapshot(10)).toEqual({
    wallMillis: 10,
    modelMillis: 0,
    toolWaitMillis: 5,
    idleMillis: 5,
    unaccountedMillis: 0,
  });
});

test("clamps ends before their starts without negative accounting", () => {
  const timeline = new RuntimeTimeline();
  timeline.startSession(0);
  timeline.startProcessing(10);
  timeline.startProvider(10);
  timeline.startTool("tool", 10);
  timeline.endProvider(5);
  timeline.endTool("tool", 5);
  timeline.settle(5);

  expect(timeline.snapshot(20)).toEqual({
    wallMillis: 20,
    modelMillis: 0,
    toolWaitMillis: 0,
    idleMillis: 20,
    unaccountedMillis: 0,
  });
});

test("caps open tool intervals at shutdown", () => {
  const timeline = new RuntimeTimeline();
  timeline.startSession(0);
  timeline.startProcessing(0);
  timeline.startProvider(0);
  timeline.startTool("tool", 0);
  timeline.shutdown(10);

  expect(timeline.snapshot(20)).toEqual({
    wallMillis: 10,
    modelMillis: 0,
    toolWaitMillis: 10,
    idleMillis: 0,
    unaccountedMillis: 0,
  });
});

test("reset discards a prior session and its open intervals", () => {
  const timeline = new RuntimeTimeline();
  timeline.startSession(0);
  timeline.startProcessing(0);
  timeline.startTool("tool", 0);
  timeline.reset();
  timeline.startSession(10);

  expect(timeline.snapshot(20)).toEqual({
    wallMillis: 10,
    modelMillis: 0,
    toolWaitMillis: 0,
    idleMillis: 10,
    unaccountedMillis: 0,
  });
});

test("classifies read write and edit execution as ordinary tool time", () => {
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

test("keeps whole-session settled time idle and active gaps other", () => {
  const state = createRuntimeStatusState();
  recordSessionStart(state, 0);
  recordProcessingStart(state, 1_000);
  recordTurnStart(state, 2_000);
  handleAssistantMessageEnd(state, 3_000, 100);
  recordAgentEnd(state, 4_000);
  recordAgentSettled(state, 5_000);

  expect(distributionSnapshot(state, 10_000)).toEqual({
    wallMillis: 10_000,
    modelMillis: 1_000,
    toolWaitMillis: 0,
    idleMillis: 6_000,
    unaccountedMillis: 3_000,
  });
});

test("formats compact session stopwatch boundaries", () => {
  expect(formatStopwatch(8_999)).toBe("8s");
  expect(formatStopwatch(134_999)).toBe("2m 14s");
  expect(formatStopwatch(3_792_999)).toBe("1h 03m 12s");
});

test("renders one tools category without files", () => {
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

test("keeps TPS on provider duration while counting tools separately", () => {
  const state = createRuntimeStatusState();
  recordSessionStart(state, 0);
  recordProcessingStart(state, 0);
  recordTurnStart(state, 1_000);
  handleAssistantMessageEnd(state, 12_000, 352);
  recordToolExecutionStart(state, "read-1", 12_000);
  recordToolExecutionEnd(state, "read-1", 12_500);
  recordAgentSettled(state, 12_500);

  expect(state.sessionAccumulation).toEqual({ tokens: 352, activeMillis: 11_000 });
  expect(distributionSnapshot(state, 12_500)).toEqual({
    wallMillis: 12_500,
    modelMillis: 11_000,
    toolWaitMillis: 500,
    idleMillis: 0,
    unaccountedMillis: 1_000,
  });
  expect(formatStatus(state, 12_500)).toContain("32.0 t/s");
});
