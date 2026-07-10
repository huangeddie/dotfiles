import { describe, expect, test } from "bun:test";

import {
  createRuntimeStatusState,
  createSubagentTelemetryAdapter,
  distributionSnapshot,
  formatStatus,
  handleAssistantMessageEnd,
  isManagedReportPath,
  isPiSubagentCommand,
  NodeReportStore,
  prepareSubagentCommand,
  recordAfterProviderResponse,
  recordAgentEnd,
  recordAgentStart,
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
  ToolIntervalLedger,
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

test("reattributes lifecycle-valid overlapping subagents proportionally by owned duration", () => {
  const ledger = new ToolIntervalLedger();
  ledger.start("first", 0);
  ledger.start("second", 5);
  ledger.end("first", 10);
  ledger.end("second", 15);
  ledger.attachSubagentReport("first", {
    version: 1, observedMillis: 10, generatingMillis: 10, toolWaitMillis: 0, idleMillis: 0,
  });
  ledger.attachSubagentReport("second", {
    version: 1, observedMillis: 5, generatingMillis: 5, toolWaitMillis: 0, idleMillis: 0,
  });

  // first owns [0,10); second owns [10,15), but its report covers half its parent duration.
  expect(ledger.project(15)).toEqual({ generatingMillis: 13, toolWaitMillis: 2, idleMillis: 0 });
});

test("publishChildReport resolves even when store write rejects", async () => {
  const store: ReportStore = {
    async create() { return "/tmp/report.json"; },
    async readAndRemove() { return null; },
    async writeAtomically() { throw new Error("write failed"); },
    async remove() {},
  };
  const report: RuntimeStatusReport = {
    version: 1, observedMillis: 10, generatingMillis: 10, toolWaitMillis: 0, idleMillis: 0,
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
      version: 1, observedMillis: 10, generatingMillis: 10, toolWaitMillis: 0, idleMillis: 0,
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
      version: 1, observedMillis: 10, generatingMillis: 10, toolWaitMillis: 0, idleMillis: 0,
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

  test("attachReportIfPresent reads and validates a report for the matching tool call", async () => {
    const store = new FakeReportStore();
    const adapter = createSubagentTelemetryAdapter(store);
    await adapter.prepare("tc-1", "pi-subagent 'inspect this'");
    const reportPath = "/tmp/runtime-0.json";
    const report = { version: 1, observedMillis: 10, generatingMillis: 4, toolWaitMillis: 3, idleMillis: 3 };
    await store.writeAtomically(reportPath, report);
    const ledger = new ToolIntervalLedger();
    ledger.start("tc-1", 0);
    ledger.end("tc-1", 10);
    await adapter.attachReportIfPresent("tc-1", ledger);
    expect(ledger.project(10)).toEqual({ generatingMillis: 4, toolWaitMillis: 3, idleMillis: 3 });
  });

  test("attachReportIfPresent ignores a missing or invalid report", async () => {
    const store = new FakeReportStore();
    const adapter = createSubagentTelemetryAdapter(store);
    await adapter.prepare("tc-1", "pi-subagent 'inspect this'");
    const ledger = new ToolIntervalLedger();
    ledger.start("tc-1", 0);
    ledger.end("tc-1", 10);
    await adapter.attachReportIfPresent("tc-1", ledger);
    expect(ledger.project(10)).toEqual({ generatingMillis: 0, toolWaitMillis: 10, idleMillis: 0 });
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

describe("ledger reconciliation", () => {
  test("distributionSnapshot adds subagent generating time to root model time", () => {
    const state = createRuntimeStatusState();
    const ledger = new ToolIntervalLedger();

    recordAgentStart(state, 0);
    recordTurnStart(state, 1_000);
    recordAfterProviderResponse(state, 1_200);
    handleAssistantMessageEnd(state, 2_000, 100);

    ledger.start("subagent", 2_000);
    ledger.end("subagent", 5_000);
    ledger.attachSubagentReport("subagent", {
      version: 1,
      observedMillis: 3_000,
      generatingMillis: 3_000,
      toolWaitMillis: 0,
      idleMillis: 0,
    });

    recordAgentEnd(state, 5_000);

    expect(distributionSnapshot(state, 5_000, ledger)).toMatchObject({
      generatingMillis: 4_000,
      toolWaitMillis: 0,
      idleMillis: 1_000,
    });
  });

  test("formatStatus reflects reconciled subagent time", () => {
    const state = createRuntimeStatusState();
    const ledger = new ToolIntervalLedger();

    recordAgentStart(state, 0);
    recordTurnStart(state, 1_000);
    recordAfterProviderResponse(state, 1_200);
    handleAssistantMessageEnd(state, 2_000, 100);

    ledger.start("subagent", 2_000);
    ledger.end("subagent", 5_000);
    ledger.attachSubagentReport("subagent", {
      version: 1,
      observedMillis: 3_000,
      generatingMillis: 3_000,
      toolWaitMillis: 0,
      idleMillis: 0,
    });

    recordAgentEnd(state, 5_000);

    expect(formatStatus(state, false, 5_000, ledger)).toBe(
      "✓ 100.0 t/s | gen 4.0s 80% | tools 0.0s 0% | idle 1.0s 20%",
    );
  });
});

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
