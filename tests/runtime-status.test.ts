import { describe, expect, test } from "bun:test";

import {
  createRuntimeStatusState,
  createSubagentTelemetryAdapter,
  distributionSnapshot,
  formatStatus,
  formatStopwatch,
  handleAssistantMessageEnd,
  isManagedReportPath,
  isPiSubagentCommand,
  NodeReportStore,
  prepareSubagentCommand,
  recordAgentEnd,
  recordAgentSettled,
  recordProcessingStart,
  recordSessionStart,
  recordTurnStart,
  recordToolExecutionEnd,
  recordToolExecutionStart,
  type FileOperations,
} from "../dot_pi/agent/exact_extensions/runtime-status";

import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  type ReportStore,
  type RuntimeStatusReport,
  publishChildReport,
  RuntimeTimeline,
  scaleReport,
  validateRuntimeStatusReport,
} from "../dot_pi/agent/runtime-status-core";

class FakeReportStore implements ReportStore {
  readonly reports = new Map<string, unknown>();
  readonly removed: string[] = [];
  readonly failRemovals = new Set<string>();
  private next = 0;

  async create(): Promise<string> {
    return `/tmp/runtime-${this.next++}.json`;
  }
  async readAndRemove(path: string): Promise<unknown | null> {
    const value = this.reports.get(path) ?? null;
    this.reports.delete(path);
    this.removed.push(path);
    return value;
  }
  async writeAtomically(path: string, report: RuntimeStatusReport): Promise<void> {
    this.reports.set(path, report);
  }
  async remove(path: string): Promise<void> {
    if (this.failRemovals.has(path)) {
      throw new Error(`remove failed for ${path}`);
    }
    this.reports.delete(path);
    this.removed.push(path);
  }
}

class FakeFileOperations implements FileOperations {
  readonly dirs = new Set<string>();
  readonly files = new Map<string, string>();
  readonly removed: string[] = [];
  failNextRename: Error | null = null;

  async mkdtemp(prefix: string): Promise<string> {
    const dir = `${prefix}fake`;
    this.dirs.add(dir);
    return dir;
  }

  async readFile(path: string, _encoding: "utf-8"): Promise<string> {
    const data = this.files.get(path);
    if (data === undefined) throw new Error("file not found");
    return data;
  }

  async writeFile(path: string, data: string, _options?: { mode?: number }): Promise<void> {
    this.files.set(path, data);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    if (this.failNextRename) {
      const err = this.failNextRename;
      this.failNextRename = null;
      throw err;
    }
    const data = this.files.get(oldPath);
    if (data === undefined) throw new Error("temp file not found");
    this.files.delete(oldPath);
    this.files.set(newPath, data);
  }

  async rm(path: string, _options?: { force?: boolean; recursive?: boolean }): Promise<void> {
    this.files.delete(path);
    this.dirs.delete(path);
    this.removed.push(path);
  }
}


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
    modelMillis: 1_000,
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
    modelMillis: 1_000,
    toolWaitMillis: 0,
    idleMillis: 2_000,
    unaccountedMillis: 3_000,
  });
});

test.failing("applies tool wait before provider coverage", () => {
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

test.failing("reattributes reported subagents across all five categories", () => {
  const timeline = new RuntimeTimeline();
  timeline.startSession(0);
  timeline.startProcessing(0);
  timeline.startTool("child", 0);
  timeline.endTool("child", 12);
  timeline.attachSubagentReport("child", {
    version: 2,
    observedMillis: 10,
    modelMillis: 3,
    toolWaitMillis: 3,
    idleMillis: 2,
    unaccountedMillis: 2,
  });
  timeline.settle(12);
  expect(timeline.snapshot(12)).toEqual({
    wallMillis: 12,
    modelMillis: 3,
    toolWaitMillis: 5,
    idleMillis: 2,
    unaccountedMillis: 2,
  });
});

test.failing("keeps a missing subagent report as ordinary tool time", () => {
  const timeline = new RuntimeTimeline();
  timeline.startSession(0);
  timeline.startProcessing(0);
  timeline.startTool("subagent", 0);
  timeline.endTool("subagent", 10);
  timeline.settle(10);
  expect(timeline.snapshot(10)).toEqual({
    wallMillis: 10,
    modelMillis: 0,
    toolWaitMillis: 10,
    idleMillis: 0,
    unaccountedMillis: 0,
  });
});

test.failing("gives overlapping subagents start-order ownership without double-counting", () => {
  const timeline = new RuntimeTimeline();
  timeline.startSession(0);
  timeline.startProcessing(0);
  timeline.startTool("first", 0);
  timeline.startTool("second", 5);
  timeline.endTool("first", 10);
  timeline.endTool("second", 15);
  timeline.attachSubagentReport("first", {
    version: 2, observedMillis: 10, modelMillis: 10, toolWaitMillis: 0, idleMillis: 0, unaccountedMillis: 0,
  });
  timeline.attachSubagentReport("second", {
    version: 2, observedMillis: 10, modelMillis: 0, toolWaitMillis: 10, idleMillis: 0, unaccountedMillis: 0,
  });
  timeline.settle(15);
  expect(timeline.snapshot(15)).toEqual({
    wallMillis: 15,
    modelMillis: 10,
    toolWaitMillis: 5,
    idleMillis: 0,
    unaccountedMillis: 0,
  });
});

test.failing("counts overlapping ordinary tools as a wall-clock union", () => {
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

test.failing("reattributes overlapping subagents proportionally by owned duration", () => {
  const timeline = new RuntimeTimeline();
  timeline.startSession(0);
  timeline.startProcessing(0);
  timeline.startTool("first", 0);
  timeline.startTool("second", 5);
  timeline.endTool("first", 10);
  timeline.endTool("second", 15);
  timeline.attachSubagentReport("first", {
    version: 2, observedMillis: 10, modelMillis: 10, toolWaitMillis: 0, idleMillis: 0, unaccountedMillis: 0,
  });
  timeline.attachSubagentReport("second", {
    version: 2, observedMillis: 5, modelMillis: 5, toolWaitMillis: 0, idleMillis: 0, unaccountedMillis: 0,
  });
  timeline.settle(15);
  expect(timeline.snapshot(15)).toEqual({
    wallMillis: 15,
    modelMillis: 13,
    toolWaitMillis: 2,
    idleMillis: 0,
    unaccountedMillis: 0,
  });
});

test.failing("ignores pre-session starts and unmatched ends", () => {
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

test.failing("ignores duplicate open interval starts", () => {
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

test.failing("clamps ends before their starts without negative accounting", () => {
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

test.failing("caps open child intervals at shutdown", () => {
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

test.failing("reset discards a prior session and its open intervals", () => {
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

test.failing("gives a reported child precedence over ordinary tool and provider time", () => {
  const timeline = new RuntimeTimeline();
  timeline.startSession(0);
  timeline.startProcessing(0);
  timeline.startProvider(0);
  timeline.startTool("file", 0);
  timeline.startTool("wait", 0);
  timeline.startTool("child", 0);
  timeline.endProvider(10);
  timeline.endTool("file", 10);
  timeline.endTool("wait", 10);
  timeline.endTool("child", 10);
  timeline.attachSubagentReport("child", {
    version: 2,
    observedMillis: 10,
    modelMillis: 0,
    toolWaitMillis: 10,
    idleMillis: 0,
    unaccountedMillis: 0,
  });
  timeline.settle(10);

  expect(timeline.snapshot(10)).toEqual({
    wallMillis: 10,
    modelMillis: 0,
    toolWaitMillis: 10,
    idleMillis: 0,
    unaccountedMillis: 0,
  });
});

test.failing("falls back to ordinary tool time for an invalid child report", () => {
  const timeline = new RuntimeTimeline();
  timeline.startSession(0);
  timeline.startProcessing(0);
  timeline.startTool("child", 0);
  timeline.endTool("child", 10);
  timeline.attachSubagentReport("child", {
    version: 2,
    observedMillis: 9,
    modelMillis: 10,
    toolWaitMillis: 0,
    idleMillis: 0,
    unaccountedMillis: 0,
  });
  timeline.settle(10);

  expect(timeline.snapshot(10)).toEqual({
    wallMillis: 10,
    modelMillis: 0,
    toolWaitMillis: 10,
    idleMillis: 0,
    unaccountedMillis: 0,
  });
});

test("publishChildReport resolves even when store write rejects", async () => {
  const store: ReportStore = {
    async create() { return "/tmp/report.json"; },
    async readAndRemove() { return null; },
    async writeAtomically() { throw new Error("write failed"); },
    async remove() {},
  };
  const report: RuntimeStatusReport = {
    version: 2, observedMillis: 10, modelMillis: 10, toolWaitMillis: 0, idleMillis: 0, unaccountedMillis: 0,
  };
  await expect(publishChildReport(store, "/tmp/report.json", report)).resolves.toBeUndefined();
});

describe("subagent command detection", () => {
  test("isPiSubagentCommand recognizes only a leading pi-subagent executable token", () => {
    expect(isPiSubagentCommand("pi-subagent 'inspect this'")).toBe(true);
    expect(isPiSubagentCommand("pi-subagent")).toBe(true);
    expect(isPiSubagentCommand("  pi-subagent  ")).toBe(true);
    expect(isPiSubagentCommand("git status")).toBe(false);
    expect(isPiSubagentCommand("pi-subagent-extra")).toBe(false);
    expect(isPiSubagentCommand("echo pi-subagent")).toBe(false);
  });

  test("prepareSubagentCommand injects a private report path only for a pi-subagent bash command", async () => {
    const store = new FakeReportStore();
    const result = await prepareSubagentCommand("pi-subagent 'inspect this'", store);
    expect(result.command).toBe(
      "export PI_RUNTIME_STATUS_REPORT_PATH='/tmp/runtime-0.json'; pi-subagent 'inspect this'",
    );
    expect(result.reportPath).toBe("/tmp/runtime-0.json");
    expect((await prepareSubagentCommand("git status", store)).command).toBe("git status");
    expect((await prepareSubagentCommand("git status", store)).reportPath).toBeNull();
  });

  test("prepareSubagentCommand escapes single quotes in the report path", async () => {
    const store = new FakeReportStore();
    store.create = async () => "/tmp/runtime-with-'quote.json";
    const result = await prepareSubagentCommand("pi-subagent 'inspect this'", store);
    expect(result.command).toBe(
      "export PI_RUNTIME_STATUS_REPORT_PATH='/tmp/runtime-with-'\\''quote.json'; pi-subagent 'inspect this'",
    );
  });

  test("prepareSubagentCommand preserves a subagent command when report allocation rejects", async () => {
    class RejectingReportStore extends FakeReportStore {
      async create(): Promise<string> {
        throw new Error("temporary directory allocation failed");
      }
    }

    const store = new RejectingReportStore();
    const command = "pi-subagent 'inspect this'";
    await expect(prepareSubagentCommand(command, store)).resolves.toEqual({ command, reportPath: null });

    const adapter = createSubagentTelemetryAdapter(store);
    await expect(adapter.prepare("tc-1", command)).resolves.toEqual({ command });
    await adapter.cleanup();
    expect(store.removed).toEqual([]);
  });
});

describe("managed report path validation", () => {
  test("isManagedReportPath accepts only absolute report.json paths under a pi-runtime-status temp dir", () => {
    const tmp = tmpdir();
    expect(isManagedReportPath(join(tmp, "pi-runtime-status-abc123", "report.json"))).toBe(true);
    expect(isManagedReportPath(join(tmp, "pi-runtime-status-abc123", "report.json").replace(/\\/g, "/"))).toBe(true);
    expect(isManagedReportPath(join("/not-tmp", "pi-runtime-status-abc123", "report.json"))).toBe(false);
    expect(isManagedReportPath(join(tmp, "other-dir", "report.json"))).toBe(false);
    expect(isManagedReportPath(join(tmp, "pi-runtime-status-abc123", "other.json"))).toBe(false);
    expect(isManagedReportPath(join(tmp, "pi-runtime-status-abc123", "report.json", "extra"))).toBe(false);
    expect(isManagedReportPath("pi-runtime-status-abc123/report.json")).toBe(false);
  });
});

describe("report store directory cleanup", () => {
  test("consuming a valid report removes the managed report directory", async () => {
    const fs = new FakeFileOperations();
    const store = new NodeReportStore(fs);
    const path = await store.create();
    const report: RuntimeStatusReport = {
      version: 2, observedMillis: 10, modelMillis: 10, toolWaitMillis: 0, idleMillis: 0, unaccountedMillis: 0,
    };
    await store.writeAtomically(path, report);
    await store.readAndRemove(path);
    expect(fs.dirs.has(dirname(path))).toBe(false);
    expect(fs.removed).toContain(dirname(path));
  });

  test("removes the managed report directory when a report is malformed", async () => {
    const fs = new FakeFileOperations();
    const store = new NodeReportStore(fs);
    const path = await store.create();
    fs.files.set(path, "not-json");
    await store.readAndRemove(path);
    expect(fs.dirs.has(dirname(path))).toBe(false);
  });

  test("removes temp file and report directory when atomic rename fails", async () => {
    const fs = new FakeFileOperations();
    const store = new NodeReportStore(fs);
    const path = await store.create();
    const report: RuntimeStatusReport = {
      version: 2, observedMillis: 10, modelMillis: 10, toolWaitMillis: 0, idleMillis: 0, unaccountedMillis: 0,
    };
    fs.failNextRename = new Error("rename failed");
    await expect(store.writeAtomically(path, report)).rejects.toThrow("rename failed");
    expect(fs.files.has(`${path}.tmp`)).toBe(false);
    expect(fs.dirs.has(dirname(path))).toBe(false);
  });
});

describe("subagent telemetry adapter", () => {
  test("prepare stores a pending report path and injects the export", async () => {
    const store = new FakeReportStore();
    const adapter = createSubagentTelemetryAdapter(store);
    const { command } = await adapter.prepare("tc-1", "pi-subagent 'inspect this'");
    expect(command).toBe(
      "export PI_RUNTIME_STATUS_REPORT_PATH='/tmp/runtime-0.json'; pi-subagent 'inspect this'",
    );
  });

  test.failing("attachReportIfPresent reads and validates a report for the matching tool call", async () => {
    const store = new FakeReportStore();
    const adapter = createSubagentTelemetryAdapter(store);
    await adapter.prepare("tc-1", "pi-subagent 'inspect this'");
    const reportPath = "/tmp/runtime-0.json";
    const report = { version: 2, observedMillis: 10, modelMillis: 4, toolWaitMillis: 3, idleMillis: 3, unaccountedMillis: 0 };
    await store.writeAtomically(reportPath, report);
    const timeline = new RuntimeTimeline();
    timeline.startSession(0);
    timeline.startProcessing(0);
    timeline.startTool("tc-1", 0);
    timeline.endTool("tc-1", 10);
    await adapter.attachReportIfPresent("tc-1", timeline);
    timeline.settle(10);
    expect(timeline.snapshot(10)).toEqual({
      wallMillis: 10,
      modelMillis: 4,
      toolWaitMillis: 3,
      idleMillis: 3,
      unaccountedMillis: 0,
    });
  });

  test.failing("attachReportIfPresent ignores a missing or invalid report", async () => {
    const store = new FakeReportStore();
    const adapter = createSubagentTelemetryAdapter(store);
    await adapter.prepare("tc-1", "pi-subagent 'inspect this'");
    const timeline = new RuntimeTimeline();
    timeline.startSession(0);
    timeline.startProcessing(0);
    timeline.startTool("tc-1", 0);
    timeline.endTool("tc-1", 10);
    await adapter.attachReportIfPresent("tc-1", timeline);
    timeline.settle(10);
    expect(timeline.snapshot(10)).toEqual({
      wallMillis: 10,
      modelMillis: 0,
      toolWaitMillis: 10,
      idleMillis: 0,
      unaccountedMillis: 0,
    });
  });

  test("cleanup removes all still-pending report paths", async () => {
    const store = new FakeReportStore();
    const adapter = createSubagentTelemetryAdapter(store);
    await adapter.prepare("tc-1", "pi-subagent 'one'");
    await adapter.prepare("tc-2", "pi-subagent 'two'");
    await adapter.cleanup();
    expect(store.removed).toEqual(["/tmp/runtime-0.json", "/tmp/runtime-1.json"]);
    expect(store.reports.size).toBe(0);
  });

  test("cleanup isolates a removal failure and still attempts every pending path", async () => {
    const store = new FakeReportStore();
    const adapter = createSubagentTelemetryAdapter(store);
    await adapter.prepare("tc-1", "pi-subagent 'one'");
    await adapter.prepare("tc-2", "pi-subagent 'two'");
    await adapter.prepare("tc-3", "pi-subagent 'three'");
    store.failRemovals.add("/tmp/runtime-1.json");

    await adapter.cleanup(); // resolves despite the isolated failure

    expect(store.removed).toEqual(["/tmp/runtime-0.json", "/tmp/runtime-2.json"]);
    await adapter.cleanup(); // second cleanup has no paths left to retry
    expect(store.removed).toEqual(["/tmp/runtime-0.json", "/tmp/runtime-2.json"]);
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

test.failing("keeps TPS on provider duration while counting tools separately", () => {
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
