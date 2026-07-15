import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  type RuntimeDistribution,
  RuntimeTimeline,
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

function renderStatus(state: RuntimeStatusState, theme: Theme): string {
  return theme.fg("dim", formatStatus(state));
}

export default function (pi: ExtensionAPI) {
  const state = createRuntimeStatusState();
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

  pi.on("tool_execution_start", (event) => {
    recordToolExecutionStart(state, event.toolCallId, Date.now());
  });

  pi.on("tool_execution_end", (event) => {
    recordToolExecutionEnd(state, event.toolCallId, Date.now());
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
    recordSessionShutdown(state, Date.now());
    stopInterval();
    if (ctx.hasUI) {
      ctx.ui.setStatus(STATUS_KEY, undefined);
    }
  });
}
