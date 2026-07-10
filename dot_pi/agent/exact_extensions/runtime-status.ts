import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import {
  type ReportStore,
  type RuntimeStatusReport,
  publishChildReport,
  ToolIntervalLedger,
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

export type TimeDistribution = {
  generatingMillis: number;
  toolWaitMillis: number;
  idleMillis: number;
  observedMillis: number;
  agentStartedAt: number | null;
  agentEndedAt: number | null;
  currentTurnStartedAt: number | null;
  messageStartedAt: number | null;
  currentToolWaitStartedAt: number | null;
  messageStartedGeneratingMillis: number;
  messageStartedToolWaitMillis: number;
};

export type RuntimeStatusState = {
  sessionAccumulation: TokenAccumulation;
  currentBurst: OutputBurst | null;
  lastBurstAccumulation: TokenAccumulation | null;
  currentMessageEstimate: TokenAccumulation;
  timeDistribution: TimeDistribution;
  active: boolean;
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
    timeDistribution: {
      generatingMillis: 0,
      toolWaitMillis: 0,
      idleMillis: 0,
      observedMillis: 0,
      agentStartedAt: null,
      agentEndedAt: null,
      currentTurnStartedAt: null,
      messageStartedAt: null,
      currentToolWaitStartedAt: null,
      messageStartedGeneratingMillis: 0,
      messageStartedToolWaitMillis: 0,
    },
    active: false,
  };
}

export function resetSession(state: RuntimeStatusState): void {
  state.sessionAccumulation = { tokens: 0, activeMillis: 0 };
  state.currentBurst = null;
  state.lastBurstAccumulation = null;
  state.currentMessageEstimate = { tokens: 0, activeMillis: 0 };
  state.timeDistribution = {
    generatingMillis: 0,
    toolWaitMillis: 0,
    idleMillis: 0,
    observedMillis: 0,
    agentStartedAt: null,
    agentEndedAt: null,
    currentTurnStartedAt: null,
    messageStartedAt: null,
    currentToolWaitStartedAt: null,
    messageStartedGeneratingMillis: 0,
    messageStartedToolWaitMillis: 0,
  };
  state.active = false;
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
  if (!state.currentBurst) {
    return;
  }
  if (now - state.currentBurst.lastOutputAt >= idleCutoffMs) {
    closeCurrentBurst(state);
  }
}

export function recordAssistantMessageStart(state: RuntimeStatusState, now: number): void {
  state.active = true;
  state.currentMessageEstimate = { tokens: 0, activeMillis: 0 };
  state.currentBurst = null;
  state.timeDistribution.messageStartedAt = now;
  state.timeDistribution.currentToolWaitStartedAt = null;
  state.timeDistribution.messageStartedGeneratingMillis = state.timeDistribution.generatingMillis;
  state.timeDistribution.messageStartedToolWaitMillis = state.timeDistribution.toolWaitMillis;
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

  state.active = true;

  if (!state.currentBurst) {
    state.currentBurst = {
      tokens: 0,
      activeMillis: 0,
      startedAt: now,
      lastOutputAt: now,
    };
  } else {
    const gap = now - state.currentBurst.lastOutputAt;
    if (gap >= OUTPUT_IDLE_CUTOFF_MS) {
      closeCurrentBurst(state);
      state.currentBurst = {
        tokens: 0,
        activeMillis: 0,
        startedAt: now,
        lastOutputAt: now,
      };
    } else {
      addStreamedActiveMillis(state, gap);
      state.currentBurst.lastOutputAt = now;
    }
  }

  state.currentBurst.tokens += tokens;
  state.sessionAccumulation.tokens += tokens;
  state.currentMessageEstimate.tokens += tokens;
}

export function recordAgentStart(state: RuntimeStatusState, now: number): void {
  state.active = true;
  state.timeDistribution.agentStartedAt = now;
  state.timeDistribution.agentEndedAt = null;
}

export function recordTurnStart(state: RuntimeStatusState, now: number): void {
  state.active = true;
  state.timeDistribution.currentTurnStartedAt = now;
}

export function recordAfterProviderResponse(state: RuntimeStatusState, now: number): void {
  void state;
  void now;
}

function closeCurrentTurnGeneration(state: RuntimeStatusState, now: number): void {
  const startedAt = state.timeDistribution.currentTurnStartedAt;
  if (startedAt === null) {
    return;
  }
  const activeMillis = Math.max(0, now - startedAt);
  state.sessionAccumulation.activeMillis += activeMillis;
  state.timeDistribution.generatingMillis += activeMillis;
  state.timeDistribution.currentTurnStartedAt = null;
}

export function recordToolExecutionStart(state: RuntimeStatusState, now: number): void {
  if (state.timeDistribution.currentToolWaitStartedAt !== null) {
    return;
  }
  if (state.timeDistribution.agentStartedAt !== null && state.timeDistribution.agentEndedAt === null) {
    state.active = true;
  }
  closeCurrentBurst(state);
  state.timeDistribution.currentToolWaitStartedAt = now;
}

export function recordToolExecutionEnd(state: RuntimeStatusState, now: number): void {
  const startedAt = state.timeDistribution.currentToolWaitStartedAt;
  if (startedAt === null) {
    return;
  }
  state.timeDistribution.toolWaitMillis += Math.max(0, now - startedAt);
  state.timeDistribution.currentToolWaitStartedAt = null;
}

function currentToolWaitMillis(state: RuntimeStatusState, now: number): number {
  const startedAt = state.timeDistribution.currentToolWaitStartedAt;
  if (startedAt === null) {
    return 0;
  }
  return Math.max(0, now - startedAt);
}

function currentProviderResponseMillis(state: RuntimeStatusState, now: number): number {
  const startedAt = state.timeDistribution.currentTurnStartedAt;
  if (startedAt === null) {
    return 0;
  }
  return Math.max(0, now - startedAt);
}

function observedRuntimeMillis(state: RuntimeStatusState, now: number): number {
  const startedAt = state.timeDistribution.agentStartedAt;
  if (startedAt === null) {
    return state.timeDistribution.observedMillis;
  }
  return state.timeDistribution.observedMillis + Math.max(0, (state.timeDistribution.agentEndedAt ?? now) - startedAt);
}

function idleMillisSnapshot(state: RuntimeStatusState, now: number): number {
  const generatingMillis = state.timeDistribution.generatingMillis + currentProviderResponseMillis(state, now);
  const toolWaitMillis = state.timeDistribution.toolWaitMillis + currentToolWaitMillis(state, now);
  return Math.max(0, observedRuntimeMillis(state, now) - generatingMillis - toolWaitMillis);
}

export function finalizeAssistantMessageTime(state: RuntimeStatusState, now: number): void {
  const messageStartedAt = state.timeDistribution.messageStartedAt;
  if (messageStartedAt === null) {
    return;
  }

  state.timeDistribution.messageStartedAt = null;
  state.timeDistribution.messageStartedGeneratingMillis = state.timeDistribution.generatingMillis;
  state.timeDistribution.messageStartedToolWaitMillis = state.timeDistribution.toolWaitMillis;
}

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
  finalizeAssistantMessageTime(state, now);
  state.currentMessageEstimate = { tokens: 0, activeMillis: 0 };
}

export function recordAgentEnd(state: RuntimeStatusState, now: number): void {
  closeCurrentTurnGeneration(state, now);
  recordToolExecutionEnd(state, now);
  if (state.timeDistribution.agentStartedAt !== null) {
    state.timeDistribution.observedMillis += Math.max(0, now - state.timeDistribution.agentStartedAt);
  }
  state.timeDistribution.agentEndedAt = now;
  state.timeDistribution.agentStartedAt = null;
  state.timeDistribution.idleMillis = idleMillisSnapshot(state, now);
  state.active = false;
}

export function rate(accumulation: TokenAccumulation | null): number {
  if (!accumulation || accumulation.tokens <= 0 || accumulation.activeMillis <= 0) {
    return 0;
  }
  return accumulation.tokens / (accumulation.activeMillis / 1000);
}

export function distributionSnapshot(
  state: RuntimeStatusState,
  now: number,
  ledger?: ToolIntervalLedger,
): TimeDistribution {
  const completedRootModelMillis = state.timeDistribution.generatingMillis + currentProviderResponseMillis(state, now);
  const ledgerProjection = ledger?.project(now) ?? {
    generatingMillis: 0,
    toolWaitMillis: 0,
    idleMillis: 0,
  };
  const generatingMillis = completedRootModelMillis + ledgerProjection.generatingMillis;
  const toolWaitMillis = ledger
    ? ledgerProjection.toolWaitMillis
    : state.timeDistribution.toolWaitMillis + currentToolWaitMillis(state, now);
  const snapshot: TimeDistribution = {
    ...state.timeDistribution,
    generatingMillis,
    toolWaitMillis,
    idleMillis: Math.max(0, observedRuntimeMillis(state, now) - generatingMillis - toolWaitMillis),
  };
  return snapshot;
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

export function createSubagentTelemetryAdapter(
  store: ReportStore,
): {
  prepare(toolCallId: string, command: string): Promise<{ command: string }>;
  attachReportIfPresent(toolCallId: string, ledger: ToolIntervalLedger): Promise<void>;
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
    async attachReportIfPresent(toolCallId: string, ledger: ToolIntervalLedger) {
      const reportPath = pendingReportPaths.get(toolCallId);
      if (!reportPath) {
        return;
      }
      pendingReportPaths.delete(toolCallId);
      const report = await store.readAndRemove(reportPath);
      const validated = report ? validateRuntimeStatusReport(report) : null;
      if (validated) {
        ledger.attachSubagentReport(toolCallId, validated);
      }
    },
    async cleanup() {
      for (const reportPath of pendingReportPaths.values()) {
        try {
          await store.remove(reportPath);
        } catch {
          // best-effort cleanup; continue with the remaining paths
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
  const token = trimmed.split(/\s+/)[0];
  return token === "pi-subagent";
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
  const reportPath = await store.create();
  const preparedCommand = `export PI_RUNTIME_STATUS_REPORT_PATH=${shellQuoteSingle(reportPath)}; ${command}`;
  return { command: preparedCommand, reportPath };
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
  const suffix = normalized.slice(tmp.length);
  return /^\/pi-runtime-status-[^/]+\/report\.json$/.test(suffix);
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
      const data = await this.fs.readFile(path, "utf-8");
      const parsed = JSON.parse(data);
      return parsed;
    } catch {
      return null;
    } finally {
      try {
        await this.fs.rm(dir, { force: true, recursive: true });
      } catch {
        // best-effort recursive removal of the managed report directory
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
        // best-effort cleanup of the sibling temporary file
      }
      try {
        await this.fs.rm(dir, { force: true, recursive: true });
      } catch {
        // best-effort cleanup of the managed report directory
      }
      throw error;
    }
  }

  async remove(path: string): Promise<void> {
    if (!isManagedReportPath(path)) {
      return;
    }
    const dir = dirname(path);
    try {
      await this.fs.rm(dir, { force: true, recursive: true });
    } catch {
      // best-effort recursive removal of the managed report directory
    }
  }
}

export function formatStatus(
  state: RuntimeStatusState,
  streaming: boolean,
  now = Date.now(),
  ledger?: ToolIntervalLedger,
): string {
  const tps = rate(state.sessionAccumulation).toFixed(1);
  const distribution = distributionSnapshot(state, now, ledger);
  const totalMillis =
    distribution.generatingMillis + distribution.toolWaitMillis + distribution.idleMillis;
  const icon = streaming ? "●" : "✓";
  return [
    `${icon} ${tps} t/s`,
    `gen ${formatSeconds(distribution.generatingMillis)} ${formatPercent(distribution.generatingMillis, totalMillis)}`,
    `tools ${formatSeconds(distribution.toolWaitMillis)} ${formatPercent(distribution.toolWaitMillis, totalMillis)}`,
    `idle ${formatSeconds(distribution.idleMillis)} ${formatPercent(distribution.idleMillis, totalMillis)}`,
  ].join(" | ");
}

function renderStatus(state: RuntimeStatusState, theme: Theme, streaming: boolean, ledger?: ToolIntervalLedger): string {
  const status = formatStatus(state, streaming, Date.now(), ledger);
  const [icon, ...rest] = status.split(" ");
  const iconColor = streaming ? "accent" : "success";
  return theme.fg(iconColor, icon) + theme.fg("dim", ` ${rest.join(" ")}`);
}

export default function (pi: ExtensionAPI) {
  const state = createRuntimeStatusState();
  const ledger = new ToolIntervalLedger();
  const store = new NodeReportStore(nodeFileOperations);
  const adapter = createSubagentTelemetryAdapter(store);
  let interval: ReturnType<typeof setInterval> | null = null;

  function stopInterval() {
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
  }

  function setStatus(ctx: ExtensionContext, streaming: boolean) {
    if (!ctx.hasUI) {
      return;
    }
    ctx.ui.setStatus(STATUS_KEY, renderStatus(state, ctx.ui.theme, streaming, ledger));
  }

  function startInterval(ctx: ExtensionContext) {
    stopInterval();
    interval = setInterval(() => {
      closeStaleBurst(state, Date.now());
      setStatus(ctx, state.active);
    }, RENDER_INTERVAL_MS);
  }

  pi.on("session_start", async (_event, ctx) => {
    resetSession(state);
    stopInterval();
    if (ctx.hasUI) {
      ctx.ui.setStatus(STATUS_KEY, undefined);
    }
  });

  pi.on("agent_start", async (_event, ctx) => {
    recordAgentStart(state, Date.now());
    startInterval(ctx);
    setStatus(ctx, true);
  });

  pi.on("turn_start", async (_event, ctx) => {
    recordTurnStart(state, Date.now());
    setStatus(ctx, true);
  });

  pi.on("after_provider_response", async (_event, ctx) => {
    recordAfterProviderResponse(state, Date.now());
    setStatus(ctx, state.active);
  });

  pi.on("message_start", async (event, ctx) => {
    if (event.message.role !== "assistant") {
      return;
    }
    recordAssistantMessageStart(state, Date.now());
    startInterval(ctx);
  });

  pi.on("message_update", async (event, ctx) => {
    recordAssistantDelta(state, event.assistantMessageEvent, Date.now());
    if (isOutputDelta(event.assistantMessageEvent)) {
      setStatus(ctx, true);
    }
  });

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

  pi.on("message_end", async (event, ctx) => {
    if (event.message.role !== "assistant") {
      return;
    }
    handleAssistantMessageEnd(state, Date.now(), event.message.usage?.output);
    setStatus(ctx, state.active);
  });

  pi.on("agent_end", async (_event, ctx) => {
    stopInterval();
    recordAgentEnd(state, Date.now());
    setStatus(ctx, false);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    stopInterval();
    handleAssistantMessageEnd(state, Date.now(), undefined);
    recordAgentEnd(state, Date.now());
    await adapter.cleanup();
    const envReportPath = process.env.PI_RUNTIME_STATUS_REPORT_PATH;
    if (envReportPath && isManagedReportPath(envReportPath)) {
      const now = Date.now();
      const distribution = distributionSnapshot(state, now, ledger);
      const report: RuntimeStatusReport = {
        version: 1,
        observedMillis: distribution.generatingMillis + distribution.toolWaitMillis + distribution.idleMillis,
        generatingMillis: distribution.generatingMillis,
        toolWaitMillis: distribution.toolWaitMillis,
        idleMillis: distribution.idleMillis,
      };
      await publishChildReport(store, envReportPath, report);
    }
    if (ctx.hasUI) {
      ctx.ui.setStatus(STATUS_KEY, undefined);
    }
  });
}
