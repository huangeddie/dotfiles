import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import {
  type ReportStore,
  type RuntimeDistribution,
  type RuntimeStatusReport,
  type SubagentReportSink,
  publishChildReport,
  RuntimeTimeline,
  validateRuntimeStatusReport,
} from "../runtime-status-core";

export const OUTPUT_IDLE_CUTOFF_MS = 750;
const RENDER_INTERVAL_MS = 200;
const STATUS_KEY = "runtime";

export type TokenAccumulation = {
  tokens: number;
  activeMillis: number;
};

export type OutputBurst = TokenAccumulation & {
  startedAt: number;
  lastOutputAt: number;
};

export type RuntimeStatusState = {
  sessionAccumulation: TokenAccumulation;
  currentBurst: OutputBurst | null;
  lastBurstAccumulation: TokenAccumulation | null;
  currentMessageEstimate: TokenAccumulation;
  currentProviderStartedAt: number | null;
  timeline: RuntimeTimeline;
};

type AssistantDelta = {
  type: string;
  delta?: string;
};

type Theme = {
  fg(name: string, text: string): string;
};

export function createRuntimeStatusState(): RuntimeStatusState {
  return {
    sessionAccumulation: { tokens: 0, activeMillis: 0 },
    currentBurst: null,
    lastBurstAccumulation: null,
    currentMessageEstimate: { tokens: 0, activeMillis: 0 },
    currentProviderStartedAt: null,
    timeline: new RuntimeTimeline(),
  };
}

export function resetSession(state: RuntimeStatusState): void {
  state.sessionAccumulation = { tokens: 0, activeMillis: 0 };
  state.currentBurst = null;
  state.lastBurstAccumulation = null;
  state.currentMessageEstimate = { tokens: 0, activeMillis: 0 };
  state.currentProviderStartedAt = null;
  state.timeline.reset();
}

export function recordSessionStart(state: RuntimeStatusState, now: number): void {
  resetSession(state);
  state.timeline.startSession(now);
}

export function recordProcessingStart(state: RuntimeStatusState, now: number): void {
  state.timeline.startProcessing(now);
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

export function estimateTokens(text: string): number {
  return text.length === 0 ? 0 : Math.max(1, Math.ceil(text.length / 4));
}

export function isOutputDelta(event: AssistantDelta): event is AssistantDelta & { delta: string } {
  return (event.type === "text_delta" || event.type === "thinking_delta") && typeof event.delta === "string";
}

function addStreamedActiveMillis(state: RuntimeStatusState, millis: number): void {
  if (!state.currentBurst || millis <= 0) {
    return;
  }
  state.currentBurst.activeMillis += millis;
  state.currentMessageEstimate.activeMillis += millis;
}

function closeCurrentBurst(state: RuntimeStatusState): void {
  if (!state.currentBurst) {
    return;
  }
  state.lastBurstAccumulation = {
    tokens: state.currentBurst.tokens,
    activeMillis: state.currentBurst.activeMillis,
  };
  state.currentBurst = null;
}

export function closeStaleBurst(
  state: RuntimeStatusState,
  now: number,
  idleCutoffMs = OUTPUT_IDLE_CUTOFF_MS,
): void {
  if (state.currentBurst && now - state.currentBurst.lastOutputAt >= idleCutoffMs) {
    closeCurrentBurst(state);
  }
}

export function recordAssistantMessageStart(state: RuntimeStatusState, _now: number): void {
  state.currentMessageEstimate = { tokens: 0, activeMillis: 0 };
  state.currentBurst = null;
}

export function recordAssistantDelta(state: RuntimeStatusState, event: AssistantDelta, now: number): void {
  if (event.type === "toolcall_start" || event.type === "toolcall_delta" || event.type === "toolcall_end") {
    closeCurrentBurst(state);
    return;
  }
  if (!isOutputDelta(event)) {
    return;
  }

  const tokens = estimateTokens(event.delta);
  if (tokens === 0) {
    return;
  }

  if (!state.currentBurst) {
    state.currentBurst = { tokens: 0, activeMillis: 0, startedAt: now, lastOutputAt: now };
  } else {
    const gap = now - state.currentBurst.lastOutputAt;
    if (gap >= OUTPUT_IDLE_CUTOFF_MS) {
      closeCurrentBurst(state);
      state.currentBurst = { tokens: 0, activeMillis: 0, startedAt: now, lastOutputAt: now };
    } else {
      addStreamedActiveMillis(state, gap);
      state.currentBurst.lastOutputAt = now;
    }
  }

  state.currentBurst.tokens += tokens;
  state.sessionAccumulation.tokens += tokens;
  state.currentMessageEstimate.tokens += tokens;
}

export function recordTurnStart(state: RuntimeStatusState, now: number): void {
  if (state.currentProviderStartedAt === null) {
    state.currentProviderStartedAt = now;
  }
  state.timeline.startProvider(now);
}

export function recordAfterProviderResponse(_state: RuntimeStatusState, _now: number): void {}

function closeCurrentTurnGeneration(state: RuntimeStatusState, now: number): void {
  const startedAt = state.currentProviderStartedAt;
  if (startedAt === null) {
    return;
  }
  state.sessionAccumulation.activeMillis += Math.max(0, now - startedAt);
  state.currentProviderStartedAt = null;
}

export function recordToolExecutionStart(
  state: RuntimeStatusState,
  toolCallId: string,
  now: number,
): void {
  closeCurrentBurst(state);
  state.timeline.startTool(toolCallId, now);
}

export function recordToolExecutionEnd(state: RuntimeStatusState, toolCallId: string, now: number): void {
  state.timeline.endTool(toolCallId, now);
}

export function finalizeAssistantMessageTime(_state: RuntimeStatusState, _now: number): void {}

export function handleAssistantMessageEnd(
  state: RuntimeStatusState,
  now: number,
  outputUsage: number | undefined,
): void {
  if (state.currentBurst) {
    const gap = now - state.currentBurst.lastOutputAt;
    if (gap > 0 && gap < OUTPUT_IDLE_CUTOFF_MS) {
      addStreamedActiveMillis(state, gap);
      state.currentBurst.lastOutputAt = now;
    }
    closeCurrentBurst(state);
  }
  if (outputUsage !== undefined) {
    state.sessionAccumulation.tokens += outputUsage - state.currentMessageEstimate.tokens;
  }

  closeCurrentTurnGeneration(state, now);
  state.timeline.endProvider(now);
  finalizeAssistantMessageTime(state, now);
  state.currentMessageEstimate = { tokens: 0, activeMillis: 0 };
}

export function recordAgentEnd(state: RuntimeStatusState, now: number): void {
  closeCurrentTurnGeneration(state, now);
  state.timeline.endProvider(now);
}

export function rate(accumulation: TokenAccumulation | null): number {
  if (!accumulation || accumulation.tokens <= 0 || accumulation.activeMillis <= 0) {
    return 0;
  }
  return accumulation.tokens / (accumulation.activeMillis / 1000);
}

export function distributionSnapshot(state: RuntimeStatusState, now: number): RuntimeDistribution {
  return state.timeline.snapshot(now);
}

function formatSeconds(millis: number): string {
  return `${(millis / 1000).toFixed(1)}s`;
}

function formatPercent(millis: number, totalMillis: number): string {
  if (millis <= 0 || totalMillis <= 0) {
    return "0%";
  }
  return `${Math.round((millis / totalMillis) * 100)}%`;
}

export function formatStopwatch(millis: number): string {
  const totalSeconds = Math.floor(Math.max(0, millis) / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  }
  return `${seconds}s`;
}

export function formatStatus(state: RuntimeStatusState, now = Date.now()): string {
  const tps = rate(state.sessionAccumulation).toFixed(1);
  const distribution = distributionSnapshot(state, now);
  const totalMillis = distribution.wallMillis;
  return [
    `⏱ ${formatStopwatch(distribution.wallMillis)}`,
    `${tps} t/s`,
    `gen ${formatSeconds(distribution.modelMillis)} ${formatPercent(distribution.modelMillis, totalMillis)}`,
    `tools ${formatSeconds(distribution.toolWaitMillis)} ${formatPercent(distribution.toolWaitMillis, totalMillis)}`,
    `idle ${formatSeconds(distribution.idleMillis)} ${formatPercent(distribution.idleMillis, totalMillis)}`,
    `other ${formatSeconds(distribution.unaccountedMillis)} ${formatPercent(distribution.unaccountedMillis, totalMillis)}`,
  ].join(" | ");
}

export function createSubagentTelemetryAdapter(
  store: ReportStore,
): {
  prepare(toolCallId: string, command: string): Promise<{ command: string }>;
  attachReportIfPresent(toolCallId: string, sink: SubagentReportSink): Promise<void>;
  cleanup(): Promise<void>;
} {
  const pendingReportPaths = new Map<string, string>();
  return {
    async prepare(toolCallId: string, command: string) {
      const prepared = await prepareSubagentCommand(command, store);
      if (prepared.reportPath) {
        pendingReportPaths.set(toolCallId, prepared.reportPath);
      }
      return { command: prepared.command };
    },
    async attachReportIfPresent(toolCallId: string, sink: SubagentReportSink) {
      const reportPath = pendingReportPaths.get(toolCallId);
      if (!reportPath) {
        return;
      }
      pendingReportPaths.delete(toolCallId);
      const report = await store.readAndRemove(reportPath);
      const validated = report ? validateRuntimeStatusReport(report) : null;
      if (validated) {
        sink.attachSubagentReport(toolCallId, validated);
      }
    },
    async cleanup() {
      for (const reportPath of pendingReportPaths.values()) {
        try {
          await store.remove(reportPath);
        } catch {
          // Best-effort cleanup must not prevent remaining reports from being removed.
        }
      }
      pendingReportPaths.clear();
    },
  };
}

export function isPiSubagentCommand(command: string): boolean {
  const trimmed = command.trim();
  if (trimmed.length === 0) {
    return false;
  }
  return trimmed.split(/\s+/)[0] === "pi-subagent";
}

function shellQuoteSingle(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export async function prepareSubagentCommand(
  command: string,
  store: ReportStore,
): Promise<{ command: string; reportPath: string | null }> {
  if (!isPiSubagentCommand(command)) {
    return { command, reportPath: null };
  }
  let reportPath: string;
  try {
    reportPath = await store.create();
  } catch {
    return { command, reportPath: null };
  }
  return {
    command: `export PI_RUNTIME_STATUS_REPORT_PATH=${shellQuoteSingle(reportPath)}; ${command}`,
    reportPath,
  };
}

export type FileOperations = {
  mkdtemp(prefix: string): Promise<string>;
  readFile(path: string, encoding: "utf-8"): Promise<string>;
  writeFile(path: string, data: string, options?: { mode?: number }): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  rm(path: string, options?: { force?: boolean; recursive?: boolean }): Promise<void>;
};

const nodeFileOperations: FileOperations = {
  mkdtemp: (prefix) => mkdtemp(prefix),
  readFile: (path, encoding) => readFile(path, encoding),
  writeFile: (path, data, options) => writeFile(path, data, options),
  rename: (oldPath, newPath) => rename(oldPath, newPath),
  rm: (path, options) => rm(path, options),
};

export function isManagedReportPath(path: string): boolean {
  if (!isAbsolute(path)) {
    return false;
  }
  const normalized = path.replace(/\\/g, "/");
  const tmp = tmpdir().replace(/\\/g, "/");
  if (!normalized.startsWith(tmp)) {
    return false;
  }
  return /^\/pi-runtime-status-[^/]+\/report\.json$/.test(normalized.slice(tmp.length));
}

export class NodeReportStore implements ReportStore {
  constructor(private readonly fs: FileOperations) {}

  async create(): Promise<string> {
    const dir = await this.fs.mkdtemp(join(tmpdir(), "pi-runtime-status-"));
    return join(dir, "report.json");
  }

  async readAndRemove(path: string): Promise<unknown | null> {
    if (!isManagedReportPath(path)) {
      return null;
    }
    const dir = dirname(path);
    try {
      return JSON.parse(await this.fs.readFile(path, "utf-8"));
    } catch {
      return null;
    } finally {
      try {
        await this.fs.rm(dir, { force: true, recursive: true });
      } catch {
        // Best-effort recursive removal of the managed report directory.
      }
    }
  }

  async writeAtomically(path: string, report: RuntimeStatusReport): Promise<void> {
    if (!isManagedReportPath(path)) {
      throw new Error("Invalid report path");
    }
    const dir = dirname(path);
    const tempPath = `${path}.tmp`;
    try {
      await this.fs.writeFile(tempPath, JSON.stringify(report), { mode: 0o600 });
      await this.fs.rename(tempPath, path);
    } catch (error) {
      try {
        await this.fs.rm(tempPath, { force: true });
      } catch {
        // Best-effort removal of the temporary report file.
      }
      try {
        await this.fs.rm(dir, { force: true, recursive: true });
      } catch {
        // Best-effort removal of the managed report directory.
      }
      throw error;
    }
  }

  async remove(path: string): Promise<void> {
    if (!isManagedReportPath(path)) {
      return;
    }
    try {
      await this.fs.rm(dirname(path), { force: true, recursive: true });
    } catch {
      // Best-effort recursive removal of the managed report directory.
    }
  }
}

function renderStatus(state: RuntimeStatusState, theme: Theme): string {
  return theme.fg("dim", formatStatus(state));
}

export default function (pi: ExtensionAPI) {
  const state = createRuntimeStatusState();
  const store = new NodeReportStore(nodeFileOperations);
  const adapter = createSubagentTelemetryAdapter(store);
  let interval: ReturnType<typeof setInterval> | null = null;

  function stopInterval() {
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
  }

  function setStatus(ctx: ExtensionContext) {
    if (ctx.hasUI) {
      ctx.ui.setStatus(STATUS_KEY, renderStatus(state, ctx.ui.theme));
    }
  }

  function startInterval(ctx: ExtensionContext) {
    stopInterval();
    interval = setInterval(() => {
      closeStaleBurst(state, Date.now());
      setStatus(ctx);
    }, RENDER_INTERVAL_MS);
  }

  pi.on("session_start", async (_event, ctx) => {
    const now = Date.now();
    recordSessionStart(state, now);
    startInterval(ctx);
    setStatus(ctx);
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    recordProcessingStart(state, Date.now());
    setStatus(ctx);
  });

  pi.on("turn_start", async (_event, ctx) => {
    recordTurnStart(state, Date.now());
    setStatus(ctx);
  });

  pi.on("after_provider_response", async (_event, ctx) => {
    recordAfterProviderResponse(state, Date.now());
    setStatus(ctx);
  });

  pi.on("message_start", async (event, _ctx) => {
    if (event.message.role === "assistant") {
      recordAssistantMessageStart(state, Date.now());
    }
  });

  pi.on("message_update", async (event, ctx) => {
    recordAssistantDelta(state, event.assistantMessageEvent, Date.now());
    if (isOutputDelta(event.assistantMessageEvent)) {
      setStatus(ctx);
    }
  });

  pi.on("tool_call", async (event) => {
    if (event.toolName !== "bash" || !isPiSubagentCommand(event.input.command)) {
      return;
    }
    const prepared = await adapter.prepare(event.toolCallId, event.input.command);
    event.input.command = prepared.command;
  });

  pi.on("tool_execution_start", (event) => {
    recordToolExecutionStart(state, event.toolCallId, Date.now());
  });

  pi.on("tool_execution_end", async (event) => {
    recordToolExecutionEnd(state, event.toolCallId, Date.now());
    await adapter.attachReportIfPresent(event.toolCallId, state.timeline);
  });

  pi.on("message_end", async (event, ctx) => {
    if (event.message.role === "assistant") {
      handleAssistantMessageEnd(state, Date.now(), event.message.usage?.output);
      setStatus(ctx);
    }
  });

  pi.on("agent_end", async (_event, ctx) => {
    recordAgentEnd(state, Date.now());
    setStatus(ctx);
  });

  pi.on("agent_settled", async (_event, ctx) => {
    recordAgentSettled(state, Date.now());
    setStatus(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    const now = Date.now();
    recordSessionShutdown(state, now);
    const distribution = distributionSnapshot(state, now);
    stopInterval();
    await adapter.cleanup();

    const envReportPath = process.env.PI_RUNTIME_STATUS_REPORT_PATH;
    if (envReportPath && isManagedReportPath(envReportPath)) {
      const report: RuntimeStatusReport = {
        version: 2,
        observedMillis: distribution.wallMillis,
        modelMillis: distribution.modelMillis,
        toolWaitMillis: distribution.toolWaitMillis,
        idleMillis: distribution.idleMillis,
        unaccountedMillis: distribution.unaccountedMillis,
      };
      await publishChildReport(store, envReportPath, report);
    }
    if (ctx.hasUI) {
      ctx.ui.setStatus(STATUS_KEY, undefined);
    }
  });
}
